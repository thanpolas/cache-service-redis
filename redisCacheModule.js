var redis = require('redis');

/**
 * redisCacheModule constructor
 * @constructor
 * @param config: {
 *    type:                 {string | 'redis'}
 *    verbose:              {boolean | false},
 *    expiration:           {integer | 900},
 *    readOnly:             {boolean | false},
 *    checkOnPreviousEmpty  {boolean | true},
 *    redisData:            {object},
 *    redisUrl:             {string},
 *    redisEnv:             {string}
 * }
 */
function redisCacheModule(config){

  var self = this;
  config = config || {};
  self.verbose = config.verbose || false;
  self.defaultExpiration = config.defaultExpiration || 900;
  self.readOnly = (typeof config.readOnly === 'boolean') ? config.readOnly : false;
  self.checkOnPreviousEmpty = (typeof config.checkOnPreviousEmpty === 'boolean') ? config.checkOnPreviousEmpty : true;

  /**
   ******************************************* PUBLIC FUNCTIONS *******************************************
   */

  /**
   * Get the value associated with a given key
   * @param {string} key
   * @param {function} cb
   * @param {string} cleanKey
   */
  self.get = function(key, cb, cleanKey){
    log(false, 'Attempting to get key:', {key: key});
    try {
      var cacheKey = (cleanKey) ? cleanKey : key;
      log(false, 'Attempting to get key:', {key: cacheKey});
      self.db.get(cacheKey, function(err, result){
        try {
          result = JSON.parse(result);
        } catch (err) {
          //Do nothing
        }
        cb(err, result);
      });
    } catch (err) {
      cb({name: 'GetException', message: err}, null);
    }
  }

  /**
   * Get multiple values given multiple keys
   * @param {array} keys
   * @param {function} cb
   * @param {integer} index
   */
  self.mget = function(keys, cb, index){
    log(false, 'Attempting to mget keys:', {keys: keys});
    self.db.mget(keys, function (err, response){
      var obj = {};
      for(var i = 0; i < response.length; i++){
        if(response[i] !== null){
          try {
            response[i] = JSON.parse(response[i]);
          } catch (err) {
            //Do nothing
          }
          obj[keys[i]] = response[i];
        }
      }
      cb(err, obj, index);
    });
  }

  /**
   * Associate a key and value and optionally set an expiration
   * @param {string} key
   * @param {string | object} value
   * @param {integer} expiration
   * @param {function} cb
   */
  self.set = function(key, value, expiration, cb){
    log(false, 'Attempting to set key:', {key: key, value: value});
    try {
      if(!self.readOnly){
        expiration = expiration || self.defaultExpiration;
        if(typeof value === 'object'){
          try {
            value = JSON.stringify(value);
          } catch (err) {
            //Do nothing
          }
        }
        cb = cb || noop;
        self.db.setex(key, expiration, value, cb);
      } 
    }catch (err) {
      log(true, 'Set failed for cache of type ' + self.type, {name: 'RedisSetException', message: err});
    }
  }

  /**
   * Associate multiple keys with multiple values and optionally set expirations per function and/or key
   * @param {object} obj
   * @param {integer} expiration
   * @param {function} cb
   */
  self.mset = function(obj, expiration, cb){
    log(false, 'Attempting to msetex data:', {data: obj});
    var multi = self.db.multi();
    for(key in obj){
      if(obj.hasOwnProperty(key)){
        var tempExpiration = expiration || self.defaultExpiration;
        var value = obj[key];
        if(typeof value === 'object' && value.cacheValue){
          tempExpiration = value.expiration || tempExpiration;
          value = value.cacheValue;
        }
        try {
          value = JSON.stringify(value);
        } catch (err) {
          //Do nothing
        }
        multi.setex(key, tempExpiration, value);
      }
    }
    multi.exec(function (err, replies){
      if(cb) cb(err, replies);
    });
  }

  /**
   * Delete the provided keys and their associated values
   * @param {array} keys
   * @param {function} cb
   */
  self.del = function(keys, cb){
    log(false, 'Attempting to delete keys:', {keys: keys});
    try {
      self.db.del(keys, function (err, count){
        if(cb){
          cb(err, count);
        }
      });
    } catch (err) {
      log(true, 'Delete failed for cache of type ' + self.type, err);
    }
  }
  
  /**
   * Flush all keys and values from all configured caches in cacheCollection
   * @param {function} cb
   */
  self.flush = function(cb){
    log(false, 'Attempting to flush all data.');
    try {
      self.db.flushall();
      log(false, 'Flushing all data from cache of type ' + self.type);
    } catch (err) {
      log(true, 'Flush failed for cache of type ' + self.type, err);
    }
    if(cb) cb();
  }

  /**
   ******************************************* PRIVATE FUNCTIONS *******************************************
   */

  /**
   * Initialize redisCacheModule given the provided constructor params
   */
  function init(){
    self.type = config.type || 'redis';
    if(config.redisMock){
      self.db = config.redisMock;
    }
    else{
      if(config.redisUrl){
        self.redisData = config.redisUrl || null;
      }
      else if(config.redisEnv){
        self.redisData = process.env[config.redisEnv] || null;
      }
      else if(config.redisData){
        self.redisData = config.redisData
      }
      self.readOnly = (typeof config.readOnly === 'boolean') ? config.readOnly : false;
      try {
        if (self.redisData) {
          if(typeof self.redisData === 'string'){
            var redisURL = require('url').parse(self.redisData);
            self.db = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true, max_attempts: 5});
            self.db.auth(redisURL.auth.split(":")[1]);
          }
          else{
            self.db = redis.createClient(self.redisData.port, self.redisData.hostname, {no_ready_check: true, max_attempts: 5});
            self.db.auth(self.redisData.auth);
          }
          self.db.on('error', function(err) {
            console.log("Error " + err);
          });
          process.on('SIGTERM', function() {
            self.db.quit();
          });
          log(false, 'Redis client created with the following defaults:', {expiration: self.defaultExpiration, verbose: self.verbose, readOnly: self.readOnly});
        } else {
          self.db = false;
          log(false, 'Redis client not created: no redis config provided');
        }
      } catch (err) {
        self.db = false;
        log(true, 'Redis client not created:', err);
      }
    }
  }

  /**
   * Error logging logic
   * @param {boolean} isError
   * @param {string} message
   * @param {object} data
   */
  function log(isError, message, data){
    var indentifier = 'redisCacheModule: ';
    if(self.verbose || isError){
      if(data) console.log(indentifier + message, data);
      else console.log(indentifier + message);
    }
  }

  var noop = function(){}

  init();
}
      
module.exports = redisCacheModule;
