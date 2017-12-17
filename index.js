'use strict';

const zlib = require('zlib');
const async = require('async');
const aws = require('aws-sdk');
const s3 = new aws.S3({signatureVersion: 'v4',apiVersion: '2006-03-01'});
const KMS_KEY_ID = process.env.KMS_KEY_ID;

exports.FireHoseTransformer = (event, context, callback) => {
    const jsonBase64ZipTransformer = function(record, done) {
        const buf = new Buffer(record.data, 'base64');
        zlib.gunzip(buf, function(error, result) {
           if(error) {
               done(null, {
                   recordId: record.recordId,
                   data:     record.data,
                   result:   'ProcessingFailed'
               });
           } else {
               /*
                  to have stream records in a separate line so Athena can recorgnize them as separate records and valid JSON
                */
               const transformed = coreTransformer(result);
               zlib.gzip(transformed, function(error, result) {
                   if(error) {
                       done(null, {
                           recordId: record.recordId,
                           data:     record.data,
                           result:   'ProcessingFailed'
                       });
                   } else {
                       done(null, {
                           recordId: record.recordId,
                           data: result.toString('base64'),
                           result: 'Ok'
                       });
                   }
               });
           }
       });
    };
    
    const coreTransformer = function(input) {
        const outputLogEventsArr = [];
        const inputJsonObj = JSON.parse(input);
        const owner = inputJsonObj.owner;
        const logStream = inputJsonObj.logStream;
        
        inputJsonObj.logEvents.forEach(function(logEvent) {
          const id = logEvent.id;
          const timestamp = logEvent.timestamp;
          const m = logEvent.message;
          const rx = /^([0-3]{1}[0-9]{1}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}),(\d{3}) (\[\D+\])  \((.+)\) (.*?): ((.|\n)+)$/g;
          const arr = rx.exec(m);
          const date = arr.slice(1, 4).join(' ');
          const time = arr.slice(4, 8).join(':');
          const loglevel = arr[8].replace('[','').replace(']','');
          const thread = arr[9];
          const classname = arr[10];
          const message = arr[11];
    
          //build a logEvent object
          const outputLogEventsObj = {};
          outputLogEventsObj.id = id;           //id of the log event
          outputLogEventsObj.dt = date;         //date of the log event
          outputLogEventsObj.tm = time;         //time of the log event in HH:mm:ss.SSS
          outputLogEventsObj.st = logStream;    //hostname where log event was generated
          outputLogEventsObj.ts = timestamp;    //timestamp UTC
          outputLogEventsObj.lv = loglevel;     //loglevel like 'ERROR', 'INFO' etc.
          outputLogEventsObj.th = thread;       //Java thread where log event was generated
          outputLogEventsObj.cl = classname;    //classname where log event was generated
          outputLogEventsObj.ms = message;      //Log message
          
          outputLogEventsArr.push(JSON.stringify(outputLogEventsObj));
        });
    
        return outputLogEventsArr.join('\n') + '\n';
    };

    //event.records is the list of records to be processed
    async.map(
        event.records,
        function(record, done) {
            jsonBase64ZipTransformer(record, done);
        },
        function(error, results) {
            if(error) {
                callback(error);
            } else {
                console.log('New line Processing completed.  Input records: ' + event.records.length + '. Output records: ' + results.length);
                callback(null, {records: results});
            }
        });
};

/*
  Files published to S3 via Firehose are GZIP compressed files [1]
  Data sent from CloudWatch Logs to Amazon Kinesis Firehose is already compressed with gzip level 6 compression, so no need to use compression within your Kinesis Firehose delivery stream.
  AWS Athena does not consider 'Content-Type' of S3 file but instead relies on the file extension to be ".gz", otherwise it starts giving ERRORs [2]
  Using S3 PUT trigger Lambda function below which renames files on PUT operation, this can be solved
  

  [1]   Reference: http://uchimanajet7.hatenablog.com/entry/2017/04/07/161835
  
  [2] HIVE_CURSOR_ERROR: Row is not a valid JSON Object - JSONException: Expected a ',' or ']' at 4 [character 5 line 1]
      This query ran against the "logs" database, unless qualified by the query. Please post the error message on our forum or contact customer support with Query Id: 4937bd8d-***
*/
exports.S3FileGzipExtensionAdder = (event, context, callback) => {
    event.Records.forEach(
         function(record) {
             const bucket = record.s3.bucket.name;
             const inputKey = record.s3.object.key;
             if(!/\.gz$/.test(inputKey)) {
               const newKey = record.s3.object.key + '.gz';
               const params = {
                 Bucket: bucket,
                 CopySource: '/' + bucket + '/' + inputKey,
                 Key: newKey,
                 ServerSideEncryption: 'aws:kms',
                 SSEKMSKeyId: KMS_KEY_ID
               };
               
               s3.copyObject(params, function(err, data) {
                  if(err) {
                    console.log('ERROR: ' + err);
                    callback(err);
                  } else {
                    //Ok copied delete original
                    const params = {
                      Bucket: bucket,
                      Key: inputKey,
                    };
                    s3.deleteObject(params, function(err, data) {
                      if(err) {
                        console.log('ERROR: ' + err);
                        callback(err);
                      } else {
                        console.log('Success copied ' + inputKey + ' to ' + newKey + ' in ' + bucket);
                        callback(null, 'Ok');
                      }
                    });
                  }
               });
            }
         }
    );
};