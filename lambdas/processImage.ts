/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { 
  SQSClient,
  SendMessageCommandInput,
  SendMessageCommand
} from '@aws-sdk/client-sqs'
import { DeleteItemCommand, DeleteItemCommandInput, DynamoDBClient, PutItemCommand, PutItemCommandInput } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client();
const DLQ_URL = process.env.DLQ_URL
const sqs = new SQSClient()
const dynamodbClient = new DynamoDBClient()
const TABLE_NAME = process.env.TABLE_NAME

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        if (messageRecord.eventName.startsWith("ObjectRemoved")) {
          console.log(`Object has been removed: ${srcKey}`)
          try {
            const deleteParams: DeleteItemCommandInput = {
              TableName: TABLE_NAME,
              Key: {
                ImageName: {S: srcKey},
              },
            }
            await dynamodbClient.send(new DeleteItemCommand(deleteParams))
            console.log(`Item: ${srcKey} successfully deleted from database`)
          } catch (error) {
            console.error(`Error deleting ${srcKey}`, error)
          }
        } else {
          let origimage = null;
          try {
            // Download the image from the S3 source bucket.
            const params: GetObjectCommandInput = {
              Bucket: srcBucket,
              Key: srcKey,
            };
            origimage = await s3.send(new GetObjectCommand(params));
            if (!srcKey.endsWith('.png') || !srcKey.endsWith('jpeg') || !srcKey.endsWith('jpg')) {
              console.log(`Invalid File Type : ${srcKey} \n Please make sure that the file is either a PNG or JPG/JPEG`)
              const dlqMsgParams: SendMessageCommandInput = {
                QueueUrl: DLQ_URL,
                MessageBody: JSON.stringify({
                    error: "unsupported file type",
                    srcBucket,
                    srcKey,
                }),
              }
              await sqs.send(new SendMessageCommand(dlqMsgParams))
              console.log(`Message sent to dead letter queue: ${srcKey}`)
            } else {
              const imageTableRequestParams: PutItemCommandInput = {
                TableName: TABLE_NAME,
                Item: {
                  ImageName: {S : srcKey}
                }
              }
              await dynamodbClient.send(new PutItemCommand(imageTableRequestParams))
              console.log(`${srcKey} added to ${TABLE_NAME}`)
            }
            // Process the image ......
          } catch (error) {
            console.log(error);
          }
        }
      }
    }
  }
};
