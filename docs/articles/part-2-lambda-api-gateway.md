# Building a Serverless REST API with AWS Lambda and API Gateway: From Zero to OpenAPI Docs

> **Series:** Building a Three-Tier Serverless Web App on AWS — Part 2 of 4
>
> **Tags:** `aws` `lambda` `serverless` `apigateway` `javascript`

---

The first time I hit a "Missing Authentication Token" error from API Gateway, I assumed the problem was with authentication. So I spent twenty minutes checking IAM permissions, looking for a missing auth header, and rereading the API Gateway docs.

The problem had nothing to do with authentication. I had simply called the wrong URL — the API root instead of the resource path. The error message is genuinely misleading.

This is Part 2 of a four-part series where I build a serverless web app on AWS from scratch. In the previous part, I set up an S3 bucket and CloudFront distribution for the frontend. In this part, we are building the **logic tier**: a Lambda function wired to API Gateway that will form the backbone of our backend.

---

## What We Are Building

A REST API with a single endpoint:

```
GET /users?userId={id}
→ Returns user data as JSON from DynamoDB (coming in Part 3)
```

The flow looks like this:

```
Browser / curl
    │
    ▼
API Gateway (REST API)
    │  Routes GET /users → Lambda proxy integration
    ▼
AWS Lambda (RetrieveUserData function)
    │  Queries DynamoDB for the requested userId
    ▼
Amazon DynamoDB
    │
    └── Returns JSON item → Lambda → API Gateway → Browser
```

---

## Part 1: The Lambda Function

### What Lambda Is (and Why It Makes Sense Here)

Lambda is compute-on-demand. You give AWS your code, and AWS runs it only when something triggers it. You pay per 100ms of execution, not for idle time.

For a backend API serving variable load, this is compelling:
- No servers to patch or scale
- Cost is directly proportional to usage (free tier covers 1M requests/month)
- Execution role (IAM) controls exactly what the function can access

### The Code

Here is the Lambda function we are deploying:

```javascript
// backend/lambda/index.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

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
        TableName: process.env.TABLE_NAME,
        Key: { userId },
      })
    );

    return result.Item
      ? response(200, result.Item)
      : response(404, { error: `No user found with userId: ${userId}` });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { error: "Internal server error" });
  }
};
```

A few things worth noting:

**Why `DynamoDBDocumentClient` instead of `DynamoDBClient` directly?**

The raw `DynamoDBClient` uses DynamoDB's type-annotated format: `{ userId: { S: "1" } }`. The `DynamoDBDocumentClient` is a higher-level abstraction that marshals/unmarshals these types automatically, so you work with plain JavaScript objects. Always use `DynamoDBDocumentClient` unless you have a reason not to.

**Why handle `OPTIONS` explicitly?**

Modern browsers send a CORS preflight `OPTIONS` request before any cross-origin `GET`. If Lambda does not return a `200` with the right headers on `OPTIONS`, the actual `GET` never happens. This is one of the CORS issues that bites nearly everyone building a serverless API for the first time.

**Why `process.env.TABLE_NAME` instead of a hardcoded table name?**

Environment variables decouple your code from your infrastructure. When you deploy the same Lambda to a staging environment with a different table, you change the environment variable — not the code.

---

## Part 2: API Gateway

### The Core Concepts

**REST API vs HTTP API**

API Gateway offers two main types. HTTP API is newer, cheaper, and simpler. REST API has more configuration options (usage plans, request/response transformations, caching, WAF integration). We are using a REST API here because it maps more directly to what most production APIs require.

**Resources and Methods**

An API is a tree of resources (URL paths) with HTTP methods attached:

```
/                 ← root resource
└── /users        ← our resource
    ├── GET       ← our method (→ Lambda)
    └── OPTIONS   ← CORS preflight (→ mock integration)
```

**Lambda Proxy Integration**

When you select *Lambda Proxy Integration*, API Gateway passes the entire HTTP request as a JSON event to your Lambda and expects Lambda to return a properly shaped response object (`statusCode`, `headers`, `body`). This is simpler and more flexible than mapping templates. It is what our code above is designed for.

The event object that Lambda receives looks like this:

```json
{
  "httpMethod": "GET",
  "path": "/users",
  "queryStringParameters": {
    "userId": "1"
  },
  "headers": { ... },
  "requestContext": { ... }
}
```

### Stages and Deployment

Every time you change your API configuration in API Gateway, those changes are not live until you *deploy* them to a *stage*. A stage is a named snapshot of your API with its own URL:

```
https://abc123.execute-api.eu-north-1.amazonaws.com/prod
https://abc123.execute-api.eu-north-1.amazonaws.com/dev
```

You can have different throttling limits, logging levels, and caching settings per stage. For this project I deployed to `prod`.

**This is why "Missing Authentication Token" happens:** If you hit the root of the stage URL (`/prod`) instead of the resource path (`/prod/users`), API Gateway does not know what you are asking for and returns that misleading error. Always include the full resource path.

---

## Part 3: Testing the API

Before connecting it to the frontend, I tested the API with a direct HTTP request:

```bash
curl "https://abc123.execute-api.eu-north-1.amazonaws.com/prod/users?userId=1"
```

At this stage, DynamoDB is not set up yet (that is Part 3), so the function returns an error. But if the API Gateway → Lambda invocation works, you will see a JSON error response, not a 403 or an XML AWS error. That tells you the plumbing is connected.

You can also test the Lambda function in isolation using the Lambda console. Create a test event:

```json
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "userId": "1"
  }
}
```

This is how I confirmed the function itself was working before debugging the API layer.

---

## Part 4: API Documentation

Once the API is deployed, I exported an OpenAPI (Swagger) specification directly from API Gateway. This gives you a machine-readable description of your API:

```json
{
  "swagger": "2.0",
  "info": {
    "title": "UserRequestAPI",
    "version": "2024-01-01T00:00:00Z"
  },
  "host": "abc123.execute-api.eu-north-1.amazonaws.com",
  "basePath": "/prod",
  "schemes": ["https"],
  "paths": {
    "/users": {
      "get": {
        "produces": ["application/json"],
        "parameters": [
          {
            "name": "userId",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responses": {
          "200": { "description": "User data returned successfully" },
          "404": { "description": "User not found" }
        }
      }
    }
  }
}
```

This documentation matters for two reasons:
1. Any developer consuming your API can understand it without asking you
2. You can import it into Postman, Insomnia, or Swagger UI for interactive testing

---

## Architecture Decisions and Trade-offs

**Why not use an HTTP API?**

HTTP API would be cheaper (~$1/million requests vs ~$3.50 for REST API) and simpler to configure CORS on. For a new project, I would now lean towards HTTP API unless I specifically needed REST API features like usage plans or request caching. The REST API here was chosen to demonstrate the full feature surface.

**Why not deploy the Lambda behind a VPC?**

DynamoDB has a public endpoint. Lambda running outside a VPC can reach it fine. Putting Lambda inside a VPC adds NAT Gateway cost (~$0.045/hour) and complexity without adding meaningful security for this use case. If DynamoDB were replaced with an RDS instance in a private subnet, the VPC conversation would be different.

**Why a single Lambda function?**

This function does one thing: retrieve a user by ID. Single-responsibility functions are easier to test, deploy, and grant permissions to. As the app grows, I would add separate functions for write operations rather than expanding this one.

---

## What's Next

In Part 3, we wire up the data tier: creating a DynamoDB table, seeding it with sample records, and tightening the IAM policy from a broad managed policy down to a precise inline policy scoped to a single table and a single action.

**[Part 3 → Fetch Data with AWS Lambda and DynamoDB](#)**

---

## Architecture Diagram

*[Include Lucidchart diagram here showing: Browser → API Gateway → Lambda Proxy Integration → Lambda Function → DynamoDB (not yet connected)]*

---

*Code for this series: [aws-three-tier-serverless on GitHub](#)*

*Kehinde Abiuwa — AWS Certified Solutions Architect (Professional) | Microsoft AZ-305*
