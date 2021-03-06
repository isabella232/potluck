if (!module.parent) { console.log("Please don't call me directly. I am just the main app's minion."); process.exit(1); }

// example:
// /images/hashcode/thumb/preset.jpeg

var options = {}
  , ttl
  , tmpDir
  , presets
  , decodeFn
  , regexp  = '';

var mkdirp    = require('mkdirp')
  , request   = require('request')
  , im        = require('imagemagick')
  , path      = require('path')
  , fs        = require('fs')
  , send      = require('send')
  , pause      = require('pause')
  , crypto    = require('crypto');

// @TODO: make imagemagick configurable in case paths are not defaults
// (maybe they can pass-in the imagemagick instance they want to use)

exports = module.exports = function thumbs(opts) {

  opts = opts || {};
  parseOptions (opts);

  return function thumbs(req, res, next) {

    if ('GET' != req.method && 'HEAD' != req.method) return next();
    var pauser = pause(req);

    var thumbRequestParts = req.originalUrl.match(regexp);
    if (!thumbRequestParts) return next();

    var encodedImageURL = thumbRequestParts[1];
    decodedImageURL = decodeFn(encodedImageURL);
    var imagePreset = thumbRequestParts[2];

    if (!presets[imagePreset]) { //non-existent preset requested.
      res.writeHead(400);
      res.end('Invalid Preset')
      return;
    }

    //-- Start creating and serving a thumbnail
    var targetDir = tmpDir + '/' + imagePreset;
    mkdirp.sync(targetDir); // Make sure tmp directory exists.

    var ext = path.extname(decodedImageURL);

    var hashedName = hash(decodedImageURL); // This is to be safe, in case somebody uses risky encodeFn

    var preset = presets[imagePreset];
    var filepath = targetDir + '/' + hashedName + ext;
    var modifiedFilePath = targetDir + '/' + hashedName + "-" + imagePreset + ext;

    // Also @see: https://github.com/mikeal/request
    var fileStream = fs.createWriteStream(filepath);
    request.get(decodedImageURL).pipe(fileStream);

    fileStream.on("close", function() {

      modifyImage({
        filepath: filepath
      , dstPath: modifiedFilePath
      , preset: preset
      }, function(err) {
        if (err) throw err;

        send(req, modifiedFilePath)
          .maxage(ttl || 0)
          .pipe(res);
        pauser.resume();
      });

    });

  };

};

exports.encodeURL = function(uri) {
  return new Buffer(url).toString('base64');
}

exports.decodeURL = function(encoded) {
  return new Buffer(encoded, 'base64').toString('ascii');
}

/**
 * Return cryptographic hash (defaulting to: "sha1") of a string.
 *
 * @param {String} str
 * @param {String} algo - Algorithm used for hashing, defaults to sha1
 * @param {String} encoding - defaults to hex
 * @return {String}
 */
var hash = function(str, algo, encoding) {
    return crypto
      .createHash(algo || 'sha1')
      .update(str)
      .digest(encoding || 'hex');
}

var parseOptions = function (options) {

  ttl = options.ttl || 3600 * 24; // cache for 1 day by default.
  decodeFn = options.decodeFn || exports.decodeURL;
  presets  = options.presets || defaultPresets();

  tmpDir   = options.tmpDir || '/tmp/nodethumbnails';

  var rootPath = options.rootPath || '/images';
  if (rootPath[0] === '/') { rootPath = rootPath.substring(1); } // be forgiving to user errors!

  var allowedExtensions = options.allowedExtensions || ['gif', 'jpg', 'jpeg'];
  for (i=0; i < allowedExtensions.length; i++) {
    // be forgiving to user errors!
    if (allowedExtensions[i][0] === '.') { allowedExtensions[i] = allowedExtensions[i].substring(1); }
  }
  var szExtensions = allowedExtensions.join('|')

  // Example: http://example.com/images/AB23DC16Hash/thumbs/small.jpg
  regexp = new RegExp('^\/' + rootPath.replace(/\//ig, '\\/') +
           '\/([%\.\-A-Za-z0-9_=\+]+)\/thumbs\/([A-Za-z0-9_]+)\.(?:' + szExtensions + ')$', 'i');
}

var defaultPresets = function() {

  return {
    small: {
      width: 120
    , compression:.5
    }
  , medium: {
      width: 300
    , compression:.7
    }
  , large: {
      width: 900
    , compression:.85
    }
  }

}

var modifyImage = function(options, callback) {

  var filepath = options.filepath;
  var dstPath = options.dstPath;
  var preset = options.preset;

  im.identify(['-format', '%wx%h', filepath], function(err, dimension){
    if (err) callback(err);

    //console.log('dimension: ' + dimension);
    // dimension: 3904x2622

    var arrDimension = dimension.split("x");
    var origWidth = arrDimension[0];
    var origHeight = arrDimension[0];

    var targetWidth = preset.width;
    // We could have just omitted height in .resize() but we may need control over this in the future.
    var targetHeight = preset.height || detectedHeight(targetWidth, origWidth, origHeight);

    im.resize({
      srcPath: filepath
      , dstPath: dstPath
      , width:   targetWidth
      , height:  targetHeight
    }, function(err, stdout, stderr){
      callback(err);
    });

  });
}

/**
 * Detect targetHeight for a proportional resizing, when only width is indicated.
 *
 * @param targetWidth
 * @param origWidth
 * @param origHeight
 */
var detectedHeight = function(targetWidth, origWidth, origHeight) {
  return origHeight * targetWidth / origWidth;
}
