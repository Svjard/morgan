/*!
 * morgan
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Module dependencies.
 * @private
 */

var auth = require('basic-auth')
var debug = require('debug')('morgan')
var deprecate = require('depd')('morgan')
var onFinished = require('on-finished')
var util = require('util')

/**
 * Array of CLF month names.
 * @private
 */

var clfmonth = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

/**
 * Default log buffer duration.
 * @private
 */

var defaultBufferDuration = 1000;

/**
 * Create a logger middleware.
 *
 * @public
 * @param {String|Function} format
 * @param {Object} [options]
 * @return {Function} middleware
 */

exports = module.exports = function morgan(format, options) {
  if (typeof format === 'object') {
    options = format
    format = options.format || 'default'

    // smart deprecation message
    deprecate('morgan(options): use morgan(' + (typeof format === 'string' ? JSON.stringify(format) : 'format') + ', options) instead')
  }

  if (format === undefined) {
    deprecate('undefined format: specify a format')
  }

  options = options || {} 

  // output on request instead of response
  var immediate = options.immediate;

  // if we are running in dev mode
  var dev = options.dev;

  // dbs settings for logging to the database
  var dbs = options.dbs;

  // hold on to the tools name
  var tool = options.tool;

  // check if log entry should be skipped
  var skip = options.skip || function () { return false; };

  // format function
  var fmt = compile(exports[format] || format || exports.default)

  // steam
  var buffer = options.buffer
  var stream = options.stream || process.stdout

  // buffering support
  if (buffer) {
    deprecate('buffer option')

    var realStream = stream
    var buf = []
    var timer = null
    var interval = 'number' == typeof buffer
      ? buffer
      : defaultBufferDuration

    // flush function
    var flush = function(){
      timer = null

      if (buf.length) {
        realStream.write(buf.join(''));
        buf.length = 0;
      }
    }

    // swap the stream
    stream = {
      write: function(str){
        if (timer === null) {
          timer = setTimeout(flush, interval)
        }

        buf.push(str);
      }
    };
  }

  return function logger(req, res, next) {
    req._startAt = process.hrtime();
    req._startTime = new Date;
    req._remoteAddress = getip(req);

    function logRequest(){
      if (skip(req, res)) {
        debug('skip request')
        return
      }

      var line = fmt(exports, req, res)

      if (null == line) {
        debug('skip line')
        return
      }

      debug('log request')
      if (dev === true) {
        stream.write(line + '\n')
      }
      else {
        try {
          var o = JSON.parse(line)
          o.timestamp = new Date(o.timestamp)
          o.tool = tool
          dbs.gsstools.log.insert(o, { 'w': 0 })
        }
        catch (e) {
          // was not valid JSON so we default to dumping to our stream
          stream.write(line + '\n')
        }
      }
    };

    // immediate
    if (immediate) {
      logRequest();
    } else {
      onFinished(res, logRequest)
    }

    next();
  };
};

/**
 * Compile `format` into a function.
 *
 * @private
 * @param {Function|String} format
 * @return {Function}
 */

function compile(format) {
  if (typeof format === 'function') {
    // already compiled
    return format
  }

  if (typeof format !== 'string') {
    throw new TypeError('argument format must be a function or string')
  }

  var fmt = format.replace(/"/g, '\\"')
  var js = '  return "' + fmt.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, function(_, name, arg){
    return '"\n    + (tokens["' + name + '"](req, res, ' + String(JSON.stringify(arg)) + ') || "-") + "';
  }) + '";'

  return new Function('tokens, req, res', js);
};

/**
 * Define a token function with the given `name`,
 * and callback `fn(req, res)`.
 *
 * @public
 * @param {String} name
 * @param {Function} fn
 * @return {Object} exports for chaining
 */

exports.token = function(name, fn) {
  exports[name] = fn;
  return this;
};

/**
 * Define a `fmt` with the given `name`.
 *
 * @public
 * @param {String} name
 * @param {String|Function} fmt
 * @return {Object} exports for chaining
 */

exports.format = function(name, fmt){
  exports[name] = fmt;
  return this;
};

/**
 * Apache combined log format in json.
 */

exports.format('combined-json', '{"remoteAddr": ":remote-addr", "user": ":remote-user", "timestamp": ":date[web]", "responseTime": :response-time, "method": ":method", "url": ":url", "version": "HTTP/:http-version", "status": :status, "res": ":res[content-length]", "userAgent": ":user-agent"}')


/**
 * Apache combined log format.
 */

exports.format('combined', ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"')

/**
 * Apache common log format.
 */

exports.format('common', ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]')

/**
 * Default format.
 */

exports.format('default', ':remote-addr - :remote-user [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"');
deprecate.property(exports, 'default', 'default format: use combined format')

/**
 * Short format.
 */

exports.format('short', ':remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms');

/**
 * Tiny format.
 */

exports.format('tiny', ':method :url :status :res[content-length] - :response-time ms');

/**
 * dev (colored)
 */

exports.format('dev', function(tokens, req, res){
  var color = 32; // green
  var status = res.statusCode;

  if (status >= 500) color = 31; // red
  else if (status >= 400) color = 33; // yellow
  else if (status >= 300) color = 36; // cyan

  var fn = compile('\x1b[0m:method :url \x1b[' + color + 'm:status \x1b[0m:response-time ms - :res[content-length]\x1b[0m');

  return fn(tokens, req, res);
});

/**
 * request url
 */

exports.token('url', function(req){
  return req.originalUrl || req.url;
});

/**
 * request method
 */

exports.token('method', function(req){
  return req.method;
});

/**
 * response time in milliseconds
 */

exports.token('response-time', function(req, res){
  if (!res._header || !req._startAt) return '';
  var diff = process.hrtime(req._startAt);
  var ms = diff[0] * 1e3 + diff[1] * 1e-6;
  return ms.toFixed(3);
});

/**
 * current date
 */

exports.token('date', function(req, res, format){
  format = format || 'web'

  var date = new Date()

  switch (format) {
    case 'clf':
      return clfdate(date)
    case 'iso':
      return date.toISOString()
    case 'web':
      return date.toUTCString()
  }
});

/**
 * response status code
 */

exports.token('status', function(req, res){
  return res._header ? res.statusCode : null;
});

/**
 * normalized referrer
 */

exports.token('referrer', function(req){
  return req.headers['referer'] || req.headers['referrer'];
});

/**
 * remote address
 */

exports.token('remote-addr', getip);

/**
 * remote user
 */

exports.token('remote-user', function (req) {
  var user = (req.session && req.session.employeeId) || '-'
  return user;
})

/**
 * HTTP version
 */

exports.token('http-version', function(req){
  return req.httpVersionMajor + '.' + req.httpVersionMinor;
});

/**
 * UA string
 */

exports.token('user-agent', function(req){
  return req.headers['user-agent'];
});

/**
 * request header
 */

exports.token('req', function(req, res, field){
  return req.headers[field.toLowerCase()];
});

/**
 * response header
 */

exports.token('res', function(req, res, field){
  return (res._headers || {})[field.toLowerCase()];
});

/**
 * Format a Date in the common log format.
 *
 * @private
 * @param {Date} dateTime
 * @return {string}
 */

function clfdate(dateTime) {
  var date = dateTime.getUTCDate()
  var hour = dateTime.getUTCHours()
  var mins = dateTime.getUTCMinutes()
  var secs = dateTime.getUTCSeconds()
  var year = dateTime.getUTCFullYear()

  var month = clfmonth[dateTime.getUTCMonth()]

  return pad2(date) + '/' + month + '/' + year
    + ':' + pad2(hour) + ':' + pad2(mins) + ':' + pad2(secs)
    + ' +0000'
}

/**
 * Get request IP address.
 *
 * @private
 * @param {IncomingMessage} req
 * @return {string}
 */

function getip(req) {
  return req.ip
    || req._remoteAddress
    || (req.connection && req.connection.remoteAddress)
    || undefined;
}

/**
 * Pad number to two digits.
 *
 * @private
 * @param {number} num
 * @return {string}
 */

function pad2(num) {
  var str = String(num)

  return (str.length === 1 ? '0' : '')
    + str
}
