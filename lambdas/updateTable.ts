import { DynamoDBClient, UpdateItemCommand, UpdateTableCommand, UpdateTableCommandOutput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SNSHandler } from "aws-lambda";

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }))

export const handler: SNSHandler = async (event) => {
    console.log("SNS Event: ", JSON.stringify(event))
    const dynamodbClient = new DynamoDBClient()

    for( const record of event.Records) {
        const message = JSON.parse(record.Sns.Message)
        const metadataType = record.Sns.MessageAttributes?.metadataType_type?.Value
        const updateBody = {
            TableName: "ImageTable",
            Key: {
                ImageName: {S: message.id }
            },
            UpdateExpression: `set ${ metadataType} = :value`,
            ExpressionAttributeValues: {
                ':value': {S: message.value }
            }
        }        
        try {
            const update: UpdateTableCommandOutput = await dynamodbClient.send(new UpdateItemCommand(updateBody))
            console.log(`Item updated successfully! \n Message ID: ${message.id}`)
        } catch (error){
            console.error(`Error :(  Failed to update: ${message.id}`, error)
        }
    }
}