// Copyright (C) 2016 Delaters
// This file is part of PARTERRA_GEE.
//
// PARTERRA_GEE is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// PARTERRA_GEE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
//  You should have received a copy of the GNU General Public License
//  along with this program.  If not, see <http://www.gnu.org/licenses/>.
//
//  link to script on GEE playground: https://code.earthengine.google.com/34bac1400fc6fbff16ae340e93df0a94

// script has pipeline for burning OSM features in SRTM
// step 1: filter OSM feature collection (fc) and set defaults
// step 2: burn to OSM_heigth map and add to SRTM
// the result is:
// 1) a Digital Surface Model (DSM; inculding actual building heights); 
// 2) a Digital Hydro Terrain Model (DHTM; a DTM suitable for flood studies with building threshold levels and minimum elevation at crossing of roads / waterways)
// some extra functions to compute difference with previous DHTM/DSM version
//
// for questions contact Dirk Eilander <dirk.eilander@deltares.nl>

// ***** some plot functionality ******
function radians(img) { return img.toFloat().multiply(3.1415927).divide(180); }

function hillshade(az, ze, slope, aspect) {
  var azimuth = radians(ee.Image(az));
  var zenith = radians(ee.Image(ze));
  return azimuth.subtract(aspect).cos().multiply(slope.sin()).multiply(zenith.sin())
      .add(zenith.cos().multiply(slope.cos()));
}

function hillshadeit(image, elevation, weight, height_multiplier) {
  var hsv  = image.unitScale(0, 255).rgbtohsv();

  var terrain = ee.call('Terrain', elevation.multiply(height_multiplier));
  var slope = radians(terrain.select(['slope']));
  var aspect = radians(terrain.select(['aspect']));
  var hs = hillshade(azimuth, zenith, slope, aspect);

  var intensity = hs.multiply(weight).multiply(hsv.select('value'));
  var huesat = hsv.select('hue', 'saturation');
  
  return ee.Image.cat(huesat, intensity).hsvtorgb();
}

var azimuth = 90;
var zenith = 60;

// visualization settings (elevation)

// function to visualize the specific DEM
var colors_dem = ['006837', '1a9850', '66bd63', 'a6d96a', 'd9ef8b', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd73027', 'a50026', 'ffffff'];
var dem_min = -5;
var dem_max = 100;

var addDem = function(dem, name, visible) {
  var im = dem.visualize({palette:colors_dem, min:dem_min, max:dem_max, opacity: 1.0});
  var hillshade_im = hillshadeit(im, dem, 2.0, 2.0);
  Map.addLayer(hillshade_im, {}, name, visible);
  return hillshade_im;
};


// **** FUNCTIONALITY STARTS BELOW *****
// ***** GENERAL filter and set default functions *****
/***
 * filters fc based on property keys & (list of) values
 * note that the filter cannot filter on mutually exclusive keys, in such case two seperate filters should be used
 */
var filter_fc = function(fc, keys, values){
  
  // function to loop over filters
  var filter_multiple = function(i, fc){
  return ee.FeatureCollection(fc).filter(ee.Filter.inList(keys.get(i), values.get(i)))};
  
  // declare keys and props as list and make index
  keys = ee.List(keys);
  values = ee.List(values);
  var index = ee.List.sequence(0,null,1, keys.length());
  
  // iterate over keys and props and return filtered fc
  return ee.FeatureCollection(index.iterate(filter_multiple, fc));
};


/***
 * filters out features from fc based  of property keys & (list of) values
 * note that the filter cannot filter on mutually exclusive keys, in such case two seperate filters should be used
 */
var filter_out_fc = function(fc, keys, values){
  
  // function to loop over filters
  var filter_multiple = function(i, fc){
  return ee.FeatureCollection(fc).filter(ee.Filter.inList(keys.get(i), values.get(i)).not())};
  
  // declare keys and props as list and make index
  keys = ee.List(keys);
  values = ee.List(values);
  var index = ee.List.sequence(0,null,1, keys.length());
  
  // iterate over keys and props and return filtered fc
  return ee.FeatureCollection(index.iterate(filter_multiple, fc));
};


/***
 * splits a feature collection based on filters
 * TODO: fix below in one function with iterate... 
 * ...couldn't get it working, see validate_fiter_building.js
 */
var split = function(fc, key, value_list){
  return [fc.filter(ee.Filter.inList(key, value_list)), 
          fc.filter(ee.Filter.inList(key, value_list).not())]; 
  };
var split2 = function(fc, key, value_list1, value_list2){
  var all_values = ee.List(value_list1).cat(value_list2);
  return [fc.filter(ee.Filter.inList(key, value_list1)), 
          fc.filter(ee.Filter.inList(key, value_list2)), 
          fc.filter(ee.Filter.inList(key, all_values).not())]; 
  }; 
var split3 = function(fc, key, value_list1, value_list2, value_list3){
  var all_values = ee.List(value_list1).cat(value_list2).cat(value_list3);
  return [fc.filter(ee.Filter.inList(key, value_list1)), 
          fc.filter(ee.Filter.inList(key, value_list2)), 
          fc.filter(ee.Filter.inList(key, value_list3)), 
          fc.filter(ee.Filter.inList(key, all_values).not())]; 
  }; 
var split4 = function(fc, key, value_list1, value_list2, value_list3, value_list4){
  var all_values = ee.List(value_list1).cat(value_list2).cat(value_list3).cat(value_list4);
  return [fc.filter(ee.Filter.inList(key, value_list1)), 
          fc.filter(ee.Filter.inList(key, value_list2)), 
          fc.filter(ee.Filter.inList(key, value_list3)), 
          fc.filter(ee.Filter.inList(key, value_list4)), 
          fc.filter(ee.Filter.inList(key, all_values).not())]; 
  };  

/***
 *split feature collection based on wheather property exist (isnull) 
 */
function splitIsNull(fc, prop) {
  return [
    fc.filter(ee.Filter.eq(ee.String(prop).cat('_isempty'), 0)).cache(), // not NULL
    fc.filter(ee.Filter.eq(ee.String(prop).cat('_isempty'), 1)).cache()   // NULL
    ];
}


/***
 * split fc based on geographical location
 * use intersect or containedIn function and filter on result
 */
function splitLoc(fc, bound, crs) {
  // make feature from geometry
  var fbound = ee.Feature(bound).transform(crs);
  // function to set property 'inbound' to true if intersect with geomatry
  var fc_inside = function(f){
  return ee.Feature(f).set('inbound',ee.Feature(f).intersects(fbound, 1, crs));
    };
  // map function of feature collection  
  fc = fc.map(fc_inside);
  // return to collection: [0] fc intersects with geometry, [1] outside geometry
  return [fc.filter(ee.Filter.eq('inbound', true)),  // [0]
          fc.filter(ee.Filter.neq('inbound', true))];// [1] 
}  
 

function split_combine_Loc(fc_list, index, bound, crs) {
  // check if waterways remaining
  var fc = ee.FeatureCollection(fc_list.get(ee.Number(index)));
  // filter based on geomatry ditch_block1
  var fc_split = ee.List(splitLoc(fc, bound, crs));
  // put list back together and return
  fc_list = fc_list.set(ee.Number(index), ee.FeatureCollection(fc_split.get(1)));
  fc_list = fc_list.add(ee.FeatureCollection(fc_split.get(0))); // inside bounds is added to end of list
  
  return fc_list;
 }
 
 
/***
 * if not exist, set property (trg_key) to default value
 */
var set_missing_value = function(fc, trg_key, default_value){
  var split = splitIsNull(fc, trg_key);

  var notnull = split[0];
  var isnull = split[1];
  
  return notnull.merge(isnull.map(function(f){return f.set(trg_key, default_value)}));
};


/***
 * set property (trg_key) to constant (Default) value
 */
var set_property_constant = function(fc, trg_key, default_value){
  return fc.map(function(f){return f.set(trg_key, default_value)});
};


/***
 * set property (trg_key) with multiply of other property 
 */
var set_property_multiply = function(fc, trg_key, prop, multiplier){
  
  function compute_property(f) {
    return f.set(trg_key, ee.Number(f.get(prop)).multiply(ee.Number(multiplier)));
  }
 
  return fc.map(compute_property);
};


/***
 * Set property (trg_key) with offset of other property
 */
var set_property_offset = function(fc, trg_key, prop, offset){
  var fc_offset = fc.map(function(f){
    return f.set(trg_key,
      ee.Number(f.get(prop))
        .add(offset))

  })
  return fc_offset
}


// ***** BUILDINGS functions *****
/***
 * set burn_height property to buildings according to following rationale:
 * if exist: 'burn_height' is taken from 'est_height' property
 * else 'burn height' is 'level_height' variable multiplied with 'building_levels' property
 *   where missing set missing 'building_levels' property with default value
 * 
 * inputs: list fc, default value building_levels, default level height
 */
var set_props_AllBuildings = function(fc_list, default_building_levels_list, level_height_list,
                                        thresh_list, manning_list) {
  
  // function for single feature
  var set_props_building = function(i, fc_in){
    // input is an index value
    // get the inputs for build_buildings with index
    var fc = ee.FeatureCollection(ee.List(fc_list).get(i));
    var default_levels = ee.Number(ee.List(default_building_levels_list).get(i));
    var level_height = ee.Number(ee.List(level_height_list).get(i));
    var thresh = ee.Number(ee.List(thresh_list).get(i)); 
    var manning = ee.Number(ee.List(manning_list).get(i)); 
    
    // fill in missing building_levels property with a default value
    fc = set_missing_value(fc, 'building_levels', default_levels);
    
    // multiply number of building_levels with level_height, map to 'burn_height' where missing
    fc = set_property_multiply(fc, 'burn_height', 'building_levels', level_height);

    // for dhtm -> set building threshold height                                    
    fc = set_property_constant(fc, 'burn_height_min', thresh);
    
    // for resistance > add manning property to all buildings
    fc = set_property_constant(fc, 'manning', manning);
    
    // return merged feature collection with burn_height property
    return fc.merge(ee.FeatureCollection(fc_in));
  };
  
  // iterate over list and return enriched merged fc; start with empty fc
  var index = ee.List.sequence(0,null,1, ee.List(fc_list).length());
  return ee.FeatureCollection(index.iterate(set_props_building, ee.FeatureCollection([])));
};


// ***** ROADS functions *****
/***
 * function creates roads (multi polygons) from lines and set 'burn height' property
 * burn_height is set based on the 'layer' property and a default offset for side walks
 */
var set_props_AllRoads = function(fc_list, default_width_list, drive_frac_list,
                                  default_layer_list, default_layer_height_list, 
                                  driveway_offset_list, sidewalk_offset_list,
                                  manning_list) {
 
  var set_props_road = function(i, fc_in){
    var fc = ee.FeatureCollection(ee.List(fc_list).get(i));
    var default_width = ee.Number(ee.List(default_width_list).get(i));  // default width of roads (in case prop_width=NULL)
    var drive_frac = ee.Number(ee.List(drive_frac_list).get(i));  // fraction of street width containing driveway
    var default_layer = ee.Number(ee.List(default_layer_list).get(i));   // default vertical layer (in case prop_layer=NULL)
    var default_layer_height = ee.Number(ee.List(default_layer_height_list).get(i));  // multiplier to convert layer to height (relative to ground)
    var sidewalk_offset = ee.Number(ee.List(sidewalk_offset_list).get(i));   
    var driveway_offset = ee.Number(ee.List(driveway_offset_list).get(i)); 
    var manning = ee.Number(ee.List(manning_list).get(i)); 
    
    // add a default road width if value is null
    fc = set_missing_value(fc, 'width', default_width);  
    // add a driveway width
    fc = set_property_multiply(fc, 'drive_width', 'width', drive_frac);  
    // add a default layer (usually zero)
    fc = set_missing_value(fc, 'layer', default_layer); 
    // add a default road height (relative to ground)
    fc = set_property_multiply(fc, 'burn_height', 'layer' ,default_layer_height); 
  
    // convert lines into road polygons
    var fc_sidewalks = fc.map(get_sidewalk);
    var fc_driveways = fc.map(get_driveway);
    
    // add an offset in burn height
    // TODO: split side walks in existing side walks and non-existing (based on sidewalk='left', 'right', 'both)
    fc_driveways = set_property_offset(fc_driveways, 'burn_height', 'burn_height', driveway_offset);
    fc_driveways = set_property_multiply(fc_driveways, 'burn_height_min', 'burn_height' ,ee.Number(1)); 
    fc_sidewalks = set_property_offset(fc_sidewalks, 'burn_height', 'burn_height', sidewalk_offset); 
    fc_sidewalks = set_property_multiply(fc_sidewalks, 'burn_height_min', 'burn_height' ,ee.Number(1)); 
    
    // set manning resistance
    fc_driveways = set_property_constant(fc_driveways, 'manning', manning);
    fc_sidewalks = set_property_constant(fc_sidewalks, 'manning', manning);

    // return a merge of the side walks and driveways
    return ee.FeatureCollection(fc_sidewalks.merge(fc_driveways)).merge(ee.FeatureCollection(fc_in)); 
  };
  
  // iterate over list and return enriched merged fc; start with empty fc
  var index = ee.List.sequence(0,null,1, ee.List(fc_list).length());
  return ee.FeatureCollection(index.iterate(set_props_road, ee.FeatureCollection([])));
};


/***
 * functions to translate OSM road (line) to driveway (polygon) & side walk (polygon)
 * (total) width and drive_width are properties of line features
 * functions are separated because map function requires only one feature as output!! 
 */
var get_driveway = function(f) {
  return f.buffer(ee.Number(f.get('drive_width')));
};
var get_sidewalk = function(f) {
  // extend the line a little bit on both sides (make sure extension is much longer than width of a typical road)
  var long_f = extend_ft(f, 0.002);
  
  // get a polygon (with total width) from the street
  var f_buf = f.buffer(ee.Number(f.get('width')));
  
  // get a polygon (with driveway width) from the street
  var driveway = long_f.buffer(ee.Number(f.get('drive_width')));
  
  // find the difference (=sidewalk) and return
  return f_buf.difference(driveway.geometry());
};


/***
 * extend line elements based on local direction on both sides
 */
var extend_ft = function(ft, extend){
  var coords = ft.geometry().coordinates();
  var coord_end_1 = ee.List(coords.get(-1));
  var coord_end_2 = ee.List(coords.get(-2));
  var coord_end_0 = extend_coord(coord_end_1, coord_end_2, extend);
  
  var coord_start_1 = ee.List(coords.get(0));
  var coord_start_2 = ee.List(coords.get(1));
  var coord_start_0 = extend_coord(coord_start_1, coord_start_2, extend);
  
  var newCoords = coords
    .insert(0, coord_start_0)
    .insert(-1, coord_end_0)
    .swap(-1, -2);
  
  return ee.Feature(
    ee.Geometry.MultiLineString([newCoords]));
};


/***
 * function creates a new coordinate that is an extention of a straight line
 * consisting of coord1 and coord2. The new coordinate can be used to extend
 * for instance a line feature
 */
var extend_coord = function(coord1, coord2, extend){
  // TODO: perform on a projected grid, instead of lat lon
  var x1 = ee.Number(coord1.get(0));
  var y1 = ee.Number(coord1.get(1));
  var x2 = ee.Number(coord2.get(0));
  var y2 = ee.Number(coord2.get(1));
  var len_x = x1.subtract(x2).pow(2);
  var len_y = y1.subtract(y2).pow(2);
  var len = len_x.add(len_y).pow(0.5);
  var sin = x2.subtract(x1).divide(len);
  var cos = y2.subtract(y1).divide(len);
  var len_scale = len.add(extend).divide(len);
  var x0 = x2.add(x1.subtract(x2).multiply(len_scale));
  var y0 = y2.add(y1.subtract(y2).multiply(len_scale));
  return ee.List([x0, y0]);
};


// ***** WATERWAYS functions *****
/***
 * function creates waterways (multi polygons) from lines and set 'burn height' property
 * burn_height is set based on the 'depth' property
 */
var set_props_AllWaterways = function(fc_list, default_depth_list,  default_width_list,
                                  manning_list) {
 
  var set_props_waterways = function(i, fc_in){
    var fc = ee.FeatureCollection(ee.List(fc_list).get(i));
    var default_depth = ee.Number(ee.List(default_width_list).get(i));  // default depth of waterway (in case prop_width=NULL)
    var default_width = ee.Number(ee.List(default_width_list).get(i));  // default width of waterway (in case prop_width=NULL)
    var manning = ee.Number(ee.List(manning_list).get(i)); 
    
    // add a default waterway width if value is null
    fc = set_missing_value(fc, 'width', default_width);  

    // add a default waterway depth if value is null
    fc = set_missing_value(fc, 'depth', default_depth); 
    fc = set_property_multiply(fc, 'burn_height', 'depth' ,ee.Number(-1)); // depth to negative burn_height
    fc = set_property_multiply(fc, 'burn_height_min', 'burn_height' ,ee.Number(1)); 
    
    // set manning resistance
    fc = set_property_constant(fc, 'manning', manning);

    // convert lines into waterway polygons
    var fc_waterway = fc.map(line2polygon);
    
    // return a merge of the side walks and driveways
    return fc_waterway.merge(ee.FeatureCollection(fc_in)); 
  };
  
  // iterate over list and return enriched merged fc; start with empty fc
  var index = ee.List.sequence(0,null,1, ee.List(fc_list).length());
  return ee.FeatureCollection(index.iterate(set_props_waterways, ee.FeatureCollection([])));
};

var line2polygon = function(f) {
  return f.buffer(ee.Number(f.get('width')));
};

// ***** LANDSUSE functions *****
/***
 * function to set manning to landuse
 * NOTE: landuse properties not yet part of fc
 */
var set_props_AllLanduse = function(fc_list, manning_list) {
 
  var set_props_landuse = function(i, fc_in){
    var fc = ee.FeatureCollection(ee.List(fc_list).get(i));
    var manning = ee.Number(ee.List(manning_list).get(i)); 
    
    // set manning resistance
    fc = set_property_constant(fc, 'manning', manning);
    // return a merge of the side walks and driveways
    return fc.merge(ee.FeatureCollection(fc_in)); 
  };
  
  // iterate over list and return enriched merged fc; start with empty fc
  var index = ee.List.sequence(0,null,1, ee.List(fc_list).length());
  return ee.FeatureCollection(index.iterate(set_props_landuse, ee.FeatureCollection([])));
};

// ***** burn functions **********
/***
 * burn property value of feature collection to map
 * fill value is zero; if multiple features take the max property value
 * 
 * inputs: feature collection with buildings, burn property, resolution
 */
var burn_map_max = function(fc, prop, resolution, fill_val) {
  // reduce fc to image using max 
  var fc_burn = fc.reduceToImage([prop], ee.Reducer.max());
  return fc_burn.unmask(fill_val).reproject('EPSG:4326', null, resolution);
};
var burn_map_min = function(fc, prop, resolution, fill_val) {
  var fc_burn = fc.reduceToImage([prop], ee.Reducer.min());
  return fc_burn.unmask(fill_val).reproject('EPSG:4326', null, resolution);
};


// ********* ALL INPUTS START HERE! *********************************
Map.setCenter(39.2665,-6.80167, 16);
// locally defined geometries
var loc0 = /* color: 98ff00 */ee.Geometry.Polygon(
        [[[39.266241788864136, -6.802859225804463],
          [39.26631152629852, -6.801655401311997],
          [39.26483631134033, -6.8016607279756816],
          [39.26482558250427, -6.8030616384759215]]]),
    loc1 = /* color: 0B4A8B */ee.Geometry.Polygon(
        [[[39.26414430201385, -6.801101427614369],
          [39.26552831928757, -6.801282533738246],
          [39.266150591260725, -6.799183823593423],
          [39.264696835003065, -6.798688444707721],
          [39.26430255156356, -6.798547286578599],
          [39.264144302210525, -6.799279705361454]]]),
    karioko = /* color: ffc82d */ee.Geometry.Polygon(
        [[[39.280006885528564, -6.82127310282852],
          [39.27844046428595, -6.816969300723082],
          [39.270780086517334, -6.819632554688664],
          [39.270527959381525, -6.8197710429662335],
          [39.26963210139297, -6.82020781242384],
          [39.26959991455078, -6.820783069557039],
          [39.270029067993164, -6.821912275907481],
          [39.27185297012329, -6.821230491259609],
          [39.272700547992144, -6.823978946527501],
          [39.27361787379493, -6.823861768532918]]]),
    magomeni = /* color: 00ffff */ee.Geometry.Polygon(
        [[[39.25357103707131, -6.814742834045893],
          [39.25762652798983, -6.815126357579189],
          [39.2624545096038, -6.8163194802816145],
          [39.26402629332483, -6.8149026226382245],
          [39.26572680317781, -6.809650657637377],
          [39.25756216274294, -6.806902138338891],
          [39.25526619289735, -6.810747930322924]]]);

// get project shape data and translate to geometries
var bounds1 = ee.Feature(ee.FeatureCollection('ft:14UJfDQmbP4-MEMt6sOV834wHGOIYK26TScAWCjaF').first()).geometry();
// get elevation data
var srtm_30 = ee.Image("USGS/SRTMGL1_003");
var info = srtm_30.getInfo().bands[0];
// DTM from preprocessing
// case 1 with Pit corr and high smoothing
var dtm = ee.Image("users/dirkeilander/dar_es_salaam_case/DTM_wRoads_0_5m_WGS84");
// case 2 no Pit corr and high smoothing
// var dtm = ee.Image("users/dirkeilander/dar_es_salaam_case/DTM_wRoads_noPitsCorr_0_5m_WGS84");
// case 3 no Pit corr low smoothing
// var dtm = ee.Image("users/dirkeilander/dar_es_salaam_case/DTM_wRoads_noPitsCorr_Smooth2_0_5m_WGS84");
// case 4 with Pit corr low smoothing
// var dtm = ee.Image("users/dirkeilander/dar_es_salaam_case/DTM_wRoads_Smooth2_0_5m_WGS84");

// get previous run results
var dhtm_old = ee.Image("users/dirkeilander/dar_es_salaam_case/DHTM_case1_0_5m_UTM37S");
var dsm_old = ee.Image("users/dirkeilander/dar_es_salaam_case/DSM_0_5m_UTM37S");
var manning_old = ee.Image("users/dirkeilander/dar_es_salaam_case/manning_0_5m_UTM37S");
var osm_maxh_old = ee.Image("users/dirkeilander/dar_es_salaam_case/osm_maxheight_0_5m_UTM37S");
var osm_minh_old = ee.Image("users/dirkeilander/dar_es_salaam_case/osm_minheight_0_5m_UTM37S");

// set main variables
var res = 0.5; // resolution in meters
var man_default = 0.05; // default manning value 

// bounding box in utm coordinates and export info
var xmin = 526352;
var xmax = 531393;
var ymin = 9245444;
var ymax = 9249492;
var w = (xmax-xmin)/res;
var h = (ymax-ymin)/res;
var dim_str = w + 'x' + h;
var crs_transform = JSON.stringify([res, 0, xmin, 0, -res, ymax]);
var region = ee.List([[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin, ymax], [xmin, ymin]]);
var bounds = ee.Geometry.Polygon(region, 'EPSG:32737', null, null, false);
var boundsWGS84 = bounds.transform(info.crs); // reproject to filter latlon fc from OSM
var exportInfoUTM = {'crs': 'EPSG:32737', 'crs_transform': crs_transform, 'dimensions': dim_str, 'driveFolder': 'GEE_export'};

// get OSM data
// ------>>> SET BOUNDS. The calculation will only focus on the features within this boundary
var bounds0 = bounds; // karioko; // magomeni;
Map.centerObject(bounds0, 16);
var osm_lines =     ee.FeatureCollection('ft:1lrYlfLqnV-dT_f6xBXP6qWWE_IJXxpJDcC1C9hKJ')
                                .filterBounds(bounds0); // version 05-07-2016
var osm_polys =     ee.FeatureCollection('ft:1By1AvgR4sw12OlqNf3-EuYEgVSOEqbYbE6WbaUfI')
                                .filterBounds(bounds0); // version 05-07-2016

// STEP 1: filter OSM features, assign properties and display
// ** buildings
// * for DSM generation
var osm_buildings = filter_out_fc(osm_polys, ['building'],[['','None','-1']]);
var buildings = ee.List(split4(osm_buildings, 'building',['residential','house'],
                                                         ['commercial','industrial','commercial;residential'],
                                                         ['school','church','college','public'],
                                                         ['apartments']));

// filter based on geometry 
buildings = split_combine_Loc(buildings, 1, karioko, info.crs);
// print('building list:')
// print(buildings.get(-1))

// set attributes
var osm_buildings = set_props_AllBuildings( buildings,
                                            // [building_residential, building_commercial, 
                                            // building_school, building_apartments], 
                                            [1, 3, 2, 6, 1, 1],  // default building levels
                                            [3, 4, 4, 4, 3, 1], // default level height
                                            [0, 0.4, 0.4, 0.4, 0.2, 1], // threshold 
                                            [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]); // manning
var buildings = ee.List(split4(osm_buildings, 'building',['residential','house'],
                                                         ['commercial','industrial','commercial;residential'],
                                                         ['school','church','college','public'],
                                                         ['apartments']));
// ** roads
// * same for DSM & DHTM
var osm_roads = filter_out_fc(osm_lines, ['highway'],[['','None','-1']]);
var roads = ee.List(split3(osm_roads, 'highway',['primary'],
                                                ['secondary','tertiary'],
                                                ['residential','unclassified']));
// set width and height attributes
var osm_roads = set_props_AllRoads(roads, // do not use unclassified roads
                                    [8, 5, 4, 2], // width
                                    [0.75, 0.75, 1, 1], // drive_frac
                                    [0, 0, 0, 0], // default layer
                                    [5, 5, 4, 4], // layer height
                                    [0.2, 0.2, 0, 0], // driveway_offset
                                    [0.4, 0.4, 0, 0], // sidewalk_offset
                                    [0.039, 0.039, 0.042, 0.042]); // manning
// display -> roads are translated to polygons now. filter roads and add to map                                    
var roads = ee.List(split3(osm_roads, 'highway',['primary'],
                                                ['secondary','tertiary'],
                                                ['residential']));         

// ** waterways
var osm_waterways = filter_out_fc(osm_lines, ['waterway'],[['','None','-1']]);
var osm_culverts = filter_fc(osm_lines,['tunnel'], [['culvert']]);
var waterways = ee.List(split3(osm_waterways, 'waterway',['ditch','stream'],
                                                      ['canal','river'],
                                                      ['drain']));
var culvert_drain = ee.FeatureCollection(waterways.get(2)).merge(osm_culverts); // combine culverts and drains

// combine waterways into 1 list
waterways = waterways.slice(0,2).add(culvert_drain);

// filter based on geometry 
waterways = split_combine_Loc(waterways, 2, loc1, info.crs);

// set width, depth and resistance properties and return polygon
var osm_waterways = set_props_AllWaterways(waterways,
                                    [1, 2, 0.5, 1], // default depth
                                    [1, 5, 1, 2], // default width list
                                    [0.028, 0.025, 0.025, 0.025]); // manning
// fiter again to get polygons and display                                    
var waterways = ee.List(split2(osm_waterways, 'waterway',['ditch','stream'],
                                                        ['canal','river']));


// STEP 2: burn OSM data to image and combine with DTM
// * combine al feature collections
var osm_all = osm_buildings.merge(osm_roads).merge(osm_waterways); 

// * digital surface model (DSM)
// burn combined fc to map and add to DTM
// compute burn height based on osm_buildings & osm_roads fc 
var osm_maxheight = burn_map_max(osm_all, 'burn_height', res, 0); // inputs: fc, burn property, resolution
var dsm = dtm.add(osm_maxheight); 
// download data in UTM format for 3di processing
Export.image(dsm, 'DSM_0_5m_UTM37S_v2', exportInfoUTM);

// * digital hydrodynamic terrain model (DHTM)
// compute burn height DHTM with min reducer based on 'burn_height_min' property. NOTE this property is only different for buildins 
// (i.e. threshold level). due to GEE bug i had to create a new variable for all fcs
var osm_minheight = burn_map_min(osm_all, 'burn_height_min', res, 0); // inputs: fc, burn property, resolution
var dhtm = dtm.add(osm_minheight); 
// download data
Export.image(dhtm, 'DHTM_0_5m_UTM37S_v2', exportInfoUTM);

// * (res) resistance map
// reduce manning property to image. default manning is set in burn_map
var manning_map = burn_map_min(osm_all, 'manning', res, man_default); // inputs: fc, burn property, resolution, fill_val
// download data
Export.image(manning_map, 'manning_0_5m_UTM37S_v2', exportInfoUTM);


// download original DTM (from preprocessinging) with same extent and crs
// Export.image(dtm, 'DTM_0_5m_UTM37S', exportInfoUTM);
// download osm_minheight
// Export.image(osm_minheight, 'osm_minheight_0_5m_UTM37S', exportInfoUTM);
// download osm_maxheight
// Export.image(osm_maxheight, 'osm_maxheight_0_5m_UTM37S', exportInfoUTM);


// * PLOT maps
// plot old results and base maps
Map.addLayer(manning_old, {min:0, max:0.5}, 'manning (old)', false);
addDem(osm_maxh_old, 'max osm heights (old)', false); 
addDem(osm_minh_old, 'min osm heights (old)', false);
addDem(srtm_30, 'srtm_30', false);
// plot original results
addDem(dtm, 'DTM', false);
addDem(dsm_old, 'DSM (old)', false);
addDem(dhtm_old, 'DHTM (old)', false);
// load and plot recent results
var dhtm_new= ee.Image("users/dirkeilander/dar_es_salaam_case/DHTM_0_5m_UTM37S_160705");
var dsm_new = ee.Image("users/dirkeilander/dar_es_salaam_case/DSM_0_5m_UTM37S_160705");
var diff_new = ee.Image("users/dirkeilander/dar_es_salaam_case/Diff_0_5m_UTM37S_160705");
addDem(dsm_new, 'DSM (05 july 2016)', true);
addDem(dhtm_new, 'DHTM (05 july 2016)', true);
Map.addLayer(diff_new, 
              {palette: ['ff0000', 'ffffff', '0000ff'], min:-1, max:1}, 'diff dhtm (05 july 2016)', false);

// plot new raster layers
Map.addLayer(manning_map.clip(bounds0), {min:0, max:0.5}, 'manning', false);
addDem(osm_maxheight.clip(bounds0), 'max osm heights', false);
addDem(osm_minheight.clip(bounds0), 'min osm heights', false);
addDem(dsm.clip(bounds0), 'DSM', false); 
addDem(dhtm.clip(bounds0), 'DHTM', false);

// plot boundary layers
Map.addLayer(bounds, {color: 'A9A9A9'}, 'bounding box', false);

// plot vector layers on top
Map.addLayer(ee.FeatureCollection(waterways.get(1)), {color: '0000FF'}, 'rivers and canals', true);
Map.addLayer(ee.FeatureCollection(waterways.get(0)), {color: 'b2b2ff'}, 'streams and ditches', true);
Map.addLayer(ee.FeatureCollection(waterways.get(2)), {color: 'D3D3D3'}, 'culverts and drains', true);
Map.addLayer(ee.FeatureCollection(roads.get(3)),     {color: 'A9A9A9'}, 'road other', true);
Map.addLayer(ee.FeatureCollection(roads.get(2)),     {color: 'B7B799'}, 'residential road ', true);
Map.addLayer(ee.FeatureCollection(roads.get(1)),     {color: 'FFFFB2'}, 'secondary road', true);
Map.addLayer(ee.FeatureCollection(roads.get(0)),     {color: 'E5E500'}, 'primary road', true);
Map.addLayer(ee.FeatureCollection(buildings.get(0)), {color: 'BB4400'}, 'residential buildings', true);
Map.addLayer(ee.FeatureCollection(buildings.get(1)), {color: '22DDFF'}, 'commercial buildings', true);
Map.addLayer(ee.FeatureCollection(buildings.get(2)), {color: 'DDFF22'}, 'public buildings', true);
Map.addLayer(ee.FeatureCollection(buildings.get(3)), {color: 'FFA500'}, 'apartment buildings', true);
Map.addLayer(ee.FeatureCollection(buildings.get(4)), {color: 'FFA500'}, 'other buildings', true);

// plot difference layer
var diff = dhtm.subtract(dhtm_old).reproject('EPSG:32737', null, 0.5);
Map.addLayer(diff.clip(bounds0), 
              {palette: ['ff0000', 'ffffff', '0000ff'], min:-1, max:1}, 'diff dhtm', false);
Export.image(diff, 'Diff_0_5m_UTM37S_v2', exportInfoUTM);