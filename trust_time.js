#!/usr/bin/env node

'use strict';

var fs = require('fs');
var crypto = require('crypto');
var async = require('async');
var bs58 = require('bs58');
var restify = require('restify');

var VERSION_BYTE = '0x00';

var BLOCKCHAIN_HOST = 'https://blockchain.info';
var BLOCKCHAIN_URL_ADDRESS = BLOCKCHAIN_HOST + '/address';

/**
 * This is the constructor of TrustTime.
 * @class
 * @classdesc This is a class to generate document address.
 */
var TrustTime = function () {
};
exports.TrustTime = TrustTime;

/**
 * This is the constructor of DocumentAddress.
 * @param {string} address The document address.
 * @param {string} sha256 The sha256 of the document.
 * @param {*} detail The internal detail of this document address.
 * @class
 * @classdesc This class used to represent a document address and provide
 * the functionality to verify the document's Trusted Timestamp.
 */
var DocumentAddress = function (address, sha256, detail) {
  this.address = address;
  this.sha256 = sha256;
  this.detail = detail;
};
exports.DocumentAddress = DocumentAddress;

/**
 * This calculate SHA256 of the document.
 * @param {string} fileName The file to calculate SHA256.
 * @param {TrustTime~requestCallback} callback The callback to call once the
 * operation completed.
 * @return {Buffer}
 */
TrustTime.prototype._sha256File = function (fileName, callback) {
  var sha256sum = crypto.createHash('SHA256');
  var stream = fs.ReadStream(fileName);
  stream.on('data', function (data) {
    sha256sum.update(data);
  });

  stream.on('end', function () {
    var bytes = sha256sum.digest();
    callback(null, bytes);
  });
};

/**
 * This callback used by TrustTime internal.
 * @callback TrustTime~requestCallback
 * @param {(string | error)} err The error if any.
 * @param {*} result The result
 */

/**
 * This function generate the RIPEMD160 of the given buffer.
 * @see {@link http://en.wikipedia.org/wiki/RIPEMD|RIPEMD wikipedia}
 * @param {Buffer} buffer The buffer
 * @returns {Buffer}
 */
TrustTime.prototype._ripemd160 = function (buffer) {
  var hash = crypto.createHash('RIPEMD160');
  hash.update(buffer);
  return hash.digest();
};

/**
 * This function generate the SHA256 of the given buffer.
 * @param {Buffer} buffer The buffer
 * @returns {Buffer}
 */
TrustTime.prototype._sha256 = function (buffer) {
  var hash = crypto.createHash('SHA256');
  hash.update(buffer);
  return hash.digest();
};

/**
 * This function add version byte to the head in a new buffer.
 * @param {Buffer} buffer The buffer to add version byte
 * @returns {Buffer}
 */
TrustTime.prototype._addVersionByte = function (buffer) {
  var buf = new Buffer(buffer.length + 1);
  buf[0] = VERSION_BYTE;
  buffer.copy(buf, 1);
  return buf;
};

/**
 * This function add checksum to the tail in a new buffer.
 * @param {Buffer} buffer The buffer to add checksum
 * @param {Buffer} checksum The checksum
 * @returns {Buffer}
 */
TrustTime.prototype._addChecksum = function (hash, checksum) {
  var hashWithChecksum = Buffer.concat(
	  [hash, checksum],hash.length + checksum.length);
  return hashWithChecksum;
};

/**
 * This function generate the document's address using the
 * document's sha256.
 * We replace the step 2 in original address generation algorithm
 * with the document's sha256.
 * @see {@link https://en.bitcoin.it/wiki/Technical_background_of_Bitcoin_addresses|address generation algorithm}
 *
 * @param {Buffer} docHash The document sha256 value stored in Buffer.
 * @returns {DocumentAddress}
 */
TrustTime.prototype.generateAddress = function (docHash) {
  var hash3 = this._ripemd160(docHash);
  var hash4 = this._addVersionByte(hash3);
  var hash5 = this._sha256(hash4);
  var hash6 = this._sha256(hash5);
  var checksum = hash6.slice(0, 4);
  var hash4WithChecksum = this._addChecksum(hash4, checksum);
  var base58Encode = bs58.encode(hash4WithChecksum);
  var detail = {
    documentSHA256: docHash.toString('hex'),
    hash3: hash3.toString('hex'),
    hash4: hash4.toString('hex'),
    hash5: hash5.toString('hex'),
    hash6: hash6.toString('hex'),
    checksum: checksum.toString('hex'),
    hashWithChecksum: hash4WithChecksum.toString('hex'),
    base58Encode: base58Encode
  };
  return new DocumentAddress(base58Encode, detail.documentSHA256, detail);
};

/**
 * This function generate the payment address for the given file.
 * @param {string} filename
 * @param {TrustTime~requestCallback} callback The callback to call once the
 * operation completed.
 */
TrustTime.prototype.generateAddressForFile = function (fileName, callback) {
  var self = this;
  async.waterfall([function (cb) {
    self._sha256File(fileName, cb);
  }, function (documentHash, cb) {
    async.nextTick(function () {
      cb(null, self.generateAddress(documentHash));
    });
  }], callback);
};

/**
 * This function verify the document's Trusted Timestamp using
 * blockchain API.
 * The first transaction time in that address is used as the
 * Trusted Timestamp.
 * @param {DocumentAddress~verifyTimestampCallback} callback
 * The callback to call once the operation
 * completed.
 */
DocumentAddress.prototype.verifyTimestamp = function (callback) {
  var client = restify.createJsonClient({
    url: BLOCKCHAIN_HOST
  });

  var options = {
    path: '/address/' + this.address + '?format=json',
    retry: 0
  };

  client.get(options,
             function (err, req, resq, data) {
    if (err) {
      console.error(err);
      callback(err);
      return;
    }
    if (!data || !data.txs || data.txs.length === 0) {
      err = 'Address not seen in the network';
      callback(err);
      return;
    }
    data.txs.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var tx = data.txs[0];
    callback(null, new Date(tx.time * 1000));
  });
};

/**
 * This is the callback used in verifyTimestamp.
 * @callback DocumentAddress~verifyTimestampCallback
 * @param {(string | error)} err The error if any.
 * @param {Date} date The date of the document was proved existed.
 */

// This block only run if it is run in console.
if (require.main === module) {

  var program = require('commander');

  // This read the argument
  program
    .version('0.0.1')
    .option('-f, --file <f>', 'File to generate address')
    .option('-v, --verify', 'To verify the trusted timestamp')
    .parse(process.argv);

  if (!program.file) {
    console.error('file argument is required');
    program.help();
    process.exit(1);
  }
  var trustTime = new TrustTime();
  trustTime.generateAddressForFile(program.file, function (err, documentAddr) {
    if (err) {
      console.error(err);
      return;
    }
    var address = documentAddr.address;
    var documentHash = documentAddr.sha256;
    var detail = documentAddr.detail;

    console.log('The address is :', address);
    console.log('The SHA256 of the document is :', documentHash);
    console.log('The url is :', BLOCKCHAIN_URL_ADDRESS + '/' + address);

    if (program.verify) {
      documentAddr.verifyTimestamp(function (err, date) {
        if (err) {
          console.error('Fail to verify Trusted Timestamp');
          console.error(err);
          process.exit(1);
        }
        console.log('Document trusted timestamp found :', date.toUTCString());
        process.exit(0);
      });
    }
  });
}
