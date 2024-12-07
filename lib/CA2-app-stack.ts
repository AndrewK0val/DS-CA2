import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SqsDestination } from "aws-cdk-lib/aws-appconfig";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { LambdaAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { userInfo } from "os";
import { eventNames } from "process";

export class CA2AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const newImgTopic = new sns.Topic(this, "newImgTopic", {
      displayName: "Demo Topic",
    })

    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    const imageTable = new dynamodb.Table(this, "ImageTable",{
      partitionKey: {
        name: "ImageName",
        type: dynamodb.AttributeType.STRING
      },
        stream: dynamodb.StreamViewType.NEW_IMAGE
      }
    )

    // Integration infrastructure

    const deadLetterQueue = new sqs.Queue(this, 'dead-letter-queue', {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    })

    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    // Lambda functions

    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          DQL_URL: deadLetterQueue.queueUrl,
        }
      }
    );

    const updateTableFn = new lambdanode.NodejsFunction(
      this,
      "UpdateTableFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/updateTable.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
        }
      }
    )

    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, 'rejection-mailer-function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    })

    const confirmationMailerFn = new lambdanode.NodejsFunction(this, 'confirmation-mailer-function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
    })

    // IAM rights and Permissions

    imagesBucket.grantRead(processImageFn)
    imageTable.grantReadWriteData(processImageFn)
    imageTable.grantReadWriteData(updateTableFn)
    imageTable.grantStreamRead(confirmationMailerFn)

    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses: SendRawEmail",
          "ses:SendTemplateEmail",
        ],
        resources: ["*"],
      })
    )


    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );
    
    rejectionMailerFn.addToRolePolicy( 
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    )

    processImageFn.addToRolePolicy (
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sqs:sendMessage"
        ],
        resources: ["*"]
      })
    )

    // Handlers 

    // Event sources for lambda functions

    // confirmationMailerFn.addEventSource(
    //   new events.DynamoEventSource( imageTable, {
    //     StartingPosition: lambda.StartingPosition.LATEST,
    //     retryAttempts: 10
    //   })
    // )

    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));


    // S3 --> SQS
    imagesBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SnsDestination(newImageTopic)  // Changed
    );


    newImageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Delete", "Photographer"]
          })
        }
      })
    );

    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist:["ObjectCreated:Put", "ObjectRemoved:Delete"],
            })),
          })
        }
      })
    )

    newImageTopic.addSubscription(
      new subs.LambdaSubscription(mailerFn, {
        filterPolicyWithMessageBody: {
          Records: sns.FilterOrPolicy.policy({
            eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
              allowlist:["ObjectCreated:Put"],
            })),
          })
        }
      })
    )



  // event srcs

  // processSQSMessageFn.addEventSource(
  //   new SqsEventSource(sqsQueue, {
  //     maxBatchingWindow: Duration.seconds(5),
  //     maxConcurrency: 2,
  //   })
  // );


  //  SQS --> Lambda
    const newImageEventSourceDLQ = new events.SqsEventSource(imageProcessQueue, {

    })

    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });

    const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }); 

    processImageFn.addEventSource(newImageEventSource);
    confirmationMailerFn.addEventSource(
      new events.DynamoEventSource(imageTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        retryAttempts: 10
      })
    )
    rejectionMailerFn.addEventSource(newImageEventSourceDLQ)
    
    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });


  }
}
