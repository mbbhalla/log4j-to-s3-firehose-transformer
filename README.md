# Helper lambda functions for storing log4j logs in S3 and querying them via Athena

Log data flows as follows
Application host with log4j ---> AWS CloudWatch Logs ---(Subscription to Firehose)---> AWS S3 <---(Query)--- AWS Athena

There are 2 functions in the package:
1. FirehoseTransformerFunction:         Firehose transformer function which transforms CloudWatch Logs records to a format suitable for Athena Querying
2. S3FileGzipExtensionAdderFunction:    GZIP extension adder function which is used with S3Put event on a bucket where Firehose creates the log files.


## Deployment

Deploying this serverless app to your AWS account is quick and easy using [AWS CloudFormation](https://aws.amazon.com/cloudformation/).

### Packaging

With the [AWS CLI](https://aws.amazon.com/cli/) installed, run the following command to upload the code to S3. You need to re-run this if you change the code in `index.js`. Be sure to set `DEPLOYMENT_S3_BUCKET` to a **bucket you own**; CloudFormation will copy the code function into a ZIP file in this S3 bucket, which can be deployed to AWS Lambda in the following steps.

```sh
DEPLOYMENT_S3_BUCKET="YOUR_S3_BUCKET"
aws cloudformation package --template-file cloudformation.yaml --s3-bucket $DEPLOYMENT_S3_BUCKET \
  --output-template-file cloudformation-packaged.yaml
```

Now you will have `cloudformation-packaged.yaml`, which contains the full path to the ZIP file created by the previous step.

### Configuring

Next, let's set the required configuration. You can set the following parameters:

 * `STACK_NAME` is the name of the CloudFormation stack that you'll create to manage all the resources (Lambda functions, CloudWatch Events, S3 buckets, IAM policies) associated with this app. You can set this to a new value to create a new instance with different parameters in your account, or use the same value when re-running to update parameters of an existing deployment.
*  `KMS_KEY_ID` is a KeyId used to encrypt data in S3. It is used by "S3FileGzipExtensionAdderFunction" function.

```sh
STACK_NAME="log4j-to-s3-firehose-transformer"
KMS_KEY_ID="your-kms-key-id"
```

With these configuration parameters defined, we can call `cloudformation deploy` to create the necessary resources in your AWS account:

```sh
aws cloudformation deploy --template-file cloudformation-packaged.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides \
  "kms_key_id=KMS_KEY_ID" \
  --stack-name $STACK_NAME
````

If all went well, your stack has been created. You can view the destination S3 bucket it created by running the following command. You can also view the stack in the AWS Console for more information.

```sh
aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs' --output text
```
