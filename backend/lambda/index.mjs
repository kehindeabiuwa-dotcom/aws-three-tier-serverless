import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "eu-north-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME ?? "UserData";

// CORS headers returned on every response so the browser's preflight and
// actual fetch both succeed when the frontend is served from CloudFront.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  const userId = event.queryStringParameters?.userId;

  if (!userId) {
    return response(400, { error: "Missing required query parameter: userId" });
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId },
      })
    );

    if (!result.Item) {
      return response(404, { error: `No user found with userId: ${userId}` });
    }

    return response(200, result.Item);
  } catch (err) {
    console.error("DynamoDB GetItem failed:", JSON.stringify(err));
    return response(500, { error: "Internal server error" });
  }
};
