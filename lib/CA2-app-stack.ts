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

    const imageTable = new dynamodb.Table(this, "ImageTable",{
      partitionKey: {
        name: "ImageName",
        type: dynamodb.AttributeType.STRING
      },
        stream: dynamodb.StreamViewType.NEW_IMAGE
      }
    )

    const deadLetterQueue = new sqs.Queue(this, 'dead-letter-queue', {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    })

    // Queues
    const badOrdersQueue = new sqs.Queue(this, "bad-orders-q", {
      retentionPeriod: Duration.minutes(10),
    });

    const ordersQueue = new sqs.Queue(this, "orders-queue", {
      deadLetterQueue: {
        queue: badOrdersQueue,
        // # of rejections by consumer (lambda function)
        maxReceiveCount: 1,
      },
    });

      // Integration infrastructure

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 1,
      },
    });

    const confirmationMailerFn = new lambdanode.NodejsFunction(this, 'confirmationMailer-function', {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(20),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
    })

    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    const deadLetterQ = new sqs.Queue(this, "dead-letter-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    })


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
        environment: {
          DQL_URL: deadLetterQ.queueUrl,
        }

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

    // Handlers 
    const processOrdersFn = new NodejsFunction(this, "ProcessOrdersFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processOrders.ts`,
      timeout: Duration.seconds(10),
      memorySize: 128,
    });

    // Generate test data
    const generateOrdersFn = new NodejsFunction(this, "GenerateOrdersFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/generateOrders.ts`,
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: {
        QUEUE_URL: ordersQueue.queueUrl,
      },
    });

    const failedOrdersFn = new NodejsFunction(this, "FailedOrdersFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      entry: `${__dirname}/../lambdas/handleBadOrder.ts`,
      timeout: Duration.seconds(10),
      memorySize: 128,
    });

    // Event sources for lambda functions

    processOrdersFn.addEventSource(
      new SqsEventSource(ordersQueue, {
        maxBatchingWindow: Duration.seconds(5),
        maxConcurrency: 2,  
      })
    );

    failedOrdersFn.addEventSource(
      new SqsEventSource(badOrdersQueue, {
        maxBatchingWindow: Duration.seconds(5),
        maxConcurrency: 2,
      })
    );

    confirmationMailerFn.addEventSource(
      new events.DynamoEventSource( imagesBucket, {
        StartingPosition: lambda.StartingPosition.LATEST,
        retryAttempts: 10
      })
    )

    

    // IAM rights and Permissions
    ordersQueue.grantSendMessages(generateOrdersFn);
    imagesBucket.grantRead(processImageFn);
    imagesBucket.grantStreamRead(confirmationMailerFn)


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
      new subs.LambdaSubscription(mailerFn)
    )



    // newImageTopic.addSubscription(
    //   new subs.SqsSubscription(imageProcessQueue)
    // );

  // subscribe

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
    // const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    //   batchSize: 5,
    //   maxBatchingWindow: cdk.Duration.seconds(5),
    // });

    // processImageFn.addEventSource(newImageEventSource);



    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "topicARN", {
      value: newImageTopic.topicArn,
    });

    new cdk.CfnOutput(this, "Generator Lambda name", {
      value: generateOrdersFn.functionName,
    });

  }
}
