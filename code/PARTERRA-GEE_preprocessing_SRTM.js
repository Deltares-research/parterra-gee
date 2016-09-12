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
//  link to script on GEE playground: https://code.earthengine.google.com/23ea3d6d1f8e39f25e3bce14966958f5


// This script does the preprocessing of SRTM data before being fused with OSM data. The script
// a) smooths SRTM with PM filter and resample to 0.5 m (this step could be done beforehand and saved as a new asset)
// b) straighten DEM for roads
// TODO (more elaborate function that corrects SRTM for (high) build-up area)
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
var colors_dem = ['006837', '1a9850', '66bd63', 'a6d96a', 'd9ef8b', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd73027', 'a50026', 'ffffff']
var dem_min = 0;
var dem_max = 100;

var addDem = function(dem, name, visible) {
  var im = dem.visualize({palette:colors_dem, min:dem_min, max:dem_max, opacity: 1.0});
  var hillshade_im = hillshadeit(im, dem, 2.0, 2.0);
  Map.addLayer(hillshade_im, {}, name, visible);
  return hillshade_im;
};


// **** FUNCTIONALITY STARTS BELOW *****
// test step 1-3 pipeline with actual OSM data

// step 1: filter OSM feature collection (fc)
/***
 * filters fc based on property keys & (list of) values
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
  

// step 2: add default info about height and widths
// ***** GENERAL functions *****
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
 * if not exist, set property (trg_key) to default value
 */
var set_property_constant = function(fc, trg_key, default_value){
  var split = splitIsNull(fc, trg_key);

  var notnull = split[0];
  var isnull = split[1];
  
  return notnull.merge(isnull.map(function(f){return f.set(trg_key, default_value)}));
};


// step 4: resamle and smooth dem
/***
 * Perona malik filter
 * I(n+1, i, j) = I(n, i, j) + lambda * (cN * dN(I) + cS * dS(I) + cE * dE(I), cW * dW(I))
 */
var peronaMalikFilter = function(I, iter, K, method) {
    var dxW = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 1, -1,  0],
                            [ 0,  0,  0]]);
  
  var dxE = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 0, -1,  1],
                            [ 0,  0,  0]]);
  
  var dyN = ee.Kernel.fixed(3, 3,
                           [[ 0,  1,  0],
                            [ 0, -1,  0],
                            [ 0,  0,  0]]);
  
  var dyS = ee.Kernel.fixed(3, 3,
                           [[ 0,  0,  0],
                            [ 0, -1,  0],
                            [ 0,  1,  0]]);

  var lambda = 0.2;

  var k1 = ee.Image(-1.0/K);
  var k2 = ee.Image(K).multiply(ee.Image(K));

  for(var i = 0; i < iter; i++) {
    var dI_W = I.convolve(dxW)
    var dI_E = I.convolve(dxE)
    var dI_N = I.convolve(dyN)
    var dI_S = I.convolve(dyS)

    switch(method) {
      case 1:
        var cW = dI_W.multiply(dI_W).multiply(k1).exp();
        var cE = dI_E.multiply(dI_E).multiply(k1).exp();
        var cN = dI_N.multiply(dI_N).multiply(k1).exp();
        var cS = dI_S.multiply(dI_S).multiply(k1).exp();
    
        I = I.add(ee.Image(lambda).multiply(cN.multiply(dI_N).add(cS.multiply(dI_S)).add(cE.multiply(dI_E)).add(cW.multiply(dI_W))))
        break;
      case 2:
        var cW = ee.Image(1.0).divide(ee.Image(1.0).add(dI_W.multiply(dI_W).divide(k2)));
        var cE = ee.Image(1.0).divide(ee.Image(1.0).add(dI_E.multiply(dI_E).divide(k2)));
        var cN = ee.Image(1.0).divide(ee.Image(1.0).add(dI_N.multiply(dI_N).divide(k2)));
        var cS = ee.Image(1.0).divide(ee.Image(1.0).add(dI_S.multiply(dI_S).divide(k2)));
    
        I = I.add(ee.Image(lambda).multiply(cN.multiply(dI_N).add(cS.multiply(dI_S)).add(cE.multiply(dI_E)).add(cW.multiply(dI_W))));
        break;
    }
  }

  return I;
};


/***
 * function makes dem straight (horizontal in perpendical direction
 * for all lines (features in fc)
*/
var straighten_dem = function(dem, fc ) {
  var info = dem.getInfo().bands[0];
  
  // function creates dem clip image with straight elev for one line
  // and adds to image collection
  var straighten_single_road = function(f, ic) {
    var width = ee.Number(f.get('width'));
    var roadBuffer = ee.Feature(f).buffer(width);
    var roadImage = 
      dem.clip(roadBuffer)
        .reduceNeighborhood(ee.Reducer.mean(), ee.Kernel.circle(ee.Number(width).multiply(2),'meters'));
    
    // weird bug in GEE requires axtra mask statemant, as otherwise the edge of the kernel is not written correctly
    return ee.ImageCollection(ic).merge(ee.ImageCollection(roadImage.mask(roadImage)
              .reproject(info.crs, info.crs_transform)));
  };
  
  // get image collection with clips for for roads and reduce to single image
  var roads_elev = ee.ImageCollection(fc.iterate(straighten_single_road,ee.ImageCollection([])))
                      .reduce(ee.Reducer.min());
  
  // fill missings with original dem
  return roads_elev.unmask(ee.Image(dem), false)
              .reproject(info.crs, info.crs_transform);
};

// ********* ALL INPUTS START HERE! *********************************
Map.setCenter(39.2665,-6.80167, 16);
// get project shape data
var bounds =        ee.Feature(ee.FeatureCollection('ft:14UJfDQmbP4-MEMt6sOV834wHGOIYK26TScAWCjaF').first()).buffer(100).geometry();
Map.addLayer(bounds, {color: 'BB4400'}, 'bounding box', false);

// get osm data
var osm_lines =     ee.FeatureCollection('ft:1lrYlfLqnV-dT_f6xBXP6qWWE_IJXxpJDcC1C9hKJ').filterBounds(bounds);

// get elev data
var srtm_30 =       ee.Image("USGS/SRTMGL1_003");
var pits_diff =     ee.Image("users/dirkeilander/dar_es_salaam_case/SRTM_30_Africa_1050009180_dem_pits_diff");
addDem(srtm_30, 'srtm_30', false);

// correct for all pits
var srtm_30_corr = srtm_30.add(pits_diff);
addDem(srtm_30_corr, 'srtm_30 pits filled (all)', true);

/***
* resample & smooth SRTM
*/
// resolution in meters
var res = 0.5; 
var info = srtm_30.getInfo().bands[0];

// apply gaus filter with small kernel
// continue without pit filling!
var dem_gaus = srtm_30_corr.convolve(ee.Kernel.gaussian(30, 15, 'meters'));
addDem(dem_gaus, 'dem_gaus', false);

// apply PM filter
var dtm = peronaMalikFilter(dem_gaus, 5, 5, 2)
                  .resample('bicubic').reproject(info.crs,null,res);
addDem(dtm, 'dtm', false);

/***
* straighten roads
*/

// load OSM lines & set width property
var road_primary = filter_fc(osm_lines,['highway'], [['primary']]);
var road_secondary = filter_fc(osm_lines, ['highway'], [['secondary']])
            .merge( filter_fc(osm_lines, ['highway'], [['tertiary']]));
Map.addLayer(road_primary,{color: 'E5E500'}, 'primary road line', false);
Map.addLayer(road_secondary,{color: 'FFFFB2'}, 'secondary road line', false);

road_primary = set_property_constant(road_primary, 'width', 10);
road_secondary = set_property_constant(road_secondary, 'width', 6);

// straighten roads in dem 
var dtm_wRoads = straighten_dem(dtm, road_primary.merge(road_secondary));
addDem(dtm_wRoads, 'dtm with roads', false);

/***
* download data
*/
// export wgs for pipeline
Export.image(dtm_wRoads, 'download_dtm_wgs', {
  'scale': res,
  'crs': 'EPSG:4326',
  'region': bounds.coordinates(),
  'driveFolder': 'GEE_export',
  'driveFileNamePrefix': 'DTM_wRoads_0_5m_WGS84'
});
