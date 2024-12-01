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

import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { SqsDestination } from "aws-cdk-lib/aws-appconfig";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { LambdaAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { userInfo } from "os";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class CA2AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const snsTopic = new sns.Topic(this, "SnsTopic", {
      displayName: "Demo Topic",
    })

    const sqsQueue = new sqs.Queue(this, "all-msg-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(5),
    })

    const failureQueue = new sqs.Queue(this, "img-created-queue",  {
      receiveMessageWaitTime: cdk.Duration.seconds(5),
    })

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

      // Integration infrastructure

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });


    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });


    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // Lambda functions

    const processSNSMessageFn = new lambdanode.NodejsFunction(
      this,
      "processSNSFn",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 128,
        timeout: cdk.Duration.seconds(3),
        entry: `${__dirname}/../lambdas/processSnsMessage.ts`,
      }
    )

    const processSQSMessageFn = new lambdanode.NodejsFunction(
      this,
      "processSQSMsgFn",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 128,
        timeout: cdk.Duration.seconds(3),
        entry: `${__dirname}/../lambdas/processSqsMessage.ts`,
      }
    );

    const processFailuresFn = new lambdanode.NodejsFunction(
      this,
      "processFailedMsgFn",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize: 128,
        timeout: cdk.Duration.seconds(3),
        entry: `${__dirname}/../lambdas/processFailures.ts`,
      }
    );

    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
      }
    );

    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

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

    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));


    const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }); 

    // S3 --> SQS
    imagesBucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SnsDestination(newImageTopic)  // Changed
    );

    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue)
    );

  // subscrib

  snsTopic.addSubscription(
    new subs.LambdaSubscription(processSNSMessageFn, {
      filterPolicy: {
        user_type: sns.SubscriptionFilter.stringFilter(
          {allowlist: ['Student', 'Lecturer']}
        ),
      },
    })
  );

  snsTopic.addSubscription(
    new subs.SqsSubscription(sqsQueue, {
      rawMessageDelivery: true,
      filterPolicy: {
        user_type: sns.SubscriptionFilter.stringFilter({
          denylist: ["Lecturer"]
        }),
        source: sns.SubscriptionFilter.stringFilter({
          matchPrefixes: ['Moodle', 'Slack']
        }),
      },
    })
  );

  // event srcs

  processSQSMessageFn.addEventSource(
    new SqsEventSource(sqsQueue, {
      maxBatchingWindow: Duration.seconds(5),
      maxConcurrency: 2,
    })
  );

  processFailuresFn.addEventSource(
    new SqsEventSource(failureQueue, {
      maxBatchingWindow: Duration.seconds(5),
      maxConcurrency: 2,
    })
  )

   // SQS --> Lambda
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });

    processImageFn.addEventSource(newImageEventSource);

    // Permissions

    imagesBucket.grantRead(processImageFn);

    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "topicARN", {
      value: newImageTopic.topicArn,
    });


  }
}
