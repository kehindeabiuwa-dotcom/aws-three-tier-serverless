# Wiring Together a Three-Tier Serverless Web App on AWS (And the CORS Bug That Broke Everything)

> **Series:** Building a Three-Tier Serverless Web App on AWS — Part 4 of 4
>
> **Tags:** `aws` `serverless` `cors` `cloudfront` `javascript` `architecture`

---

After three parts of building individual pieces — a CloudFront frontend, a Lambda API, and a DynamoDB data layer — we now have three working components that have never actually spoken to each other.

This is the part where you find out if your architecture actually holds together. And almost always, the answer is: "not yet, there is a CORS error."

This is the final part of the series. We wire everything together, debug the inevitable integration failures, and end up with a working end-to-end serverless web application on AWS.

![The completed three-tier serverless web app on AWS](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-4/01-cover-intro.png)
*All three tiers finally wired together into one working application.*

---

## The Complete Architecture

```
User's Browser
     │
     ▼
Amazon CloudFront  ◄────── S3 Bucket (private, OAC)
     │                     [index.html, style.css, script.js]
     │  GET /users?userId=1
     ▼
Amazon API Gateway (REST API, /prod stage)
     │  Lambda Proxy Integration
     ▼
AWS Lambda (RetrieveUserData)
     │  dynamodb:GetItem  [IAM inline policy, scoped to table ARN]
     ▼
Amazon DynamoDB (UserData table, On-Demand)
     │
     └── { userId: "1", name: "Test User", email: "test@example.com" }
```

Each tier is independently scalable, independently deployable, and locked down with least-privilege IAM.

![Part 4 full three-tier architecture diagram](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/diagrams/part-4-full-architecture.png)
*The complete three-tier architecture — S3/CloudFront frontend, API Gateway + Lambda logic tier, and DynamoDB data tier.*

---

## Step 1: Connect the Presentation Tier to the Logic Tier

The frontend (`script.js`) has a placeholder URL:

```javascript
const API_URL = "https://YOUR-API-ID.execute-api.YOUR-REGION.amazonaws.com/prod/users";
```

I replaced this with the real API Gateway Invoke URL, re-uploaded `script.js` to S3, and opened the CloudFront URL in my browser.

Immediately: a console error.

```
Failed to fetch
TypeError: Failed to fetch
    at fetchUser (script.js:14)
```

Not a CORS error — a completely failed fetch. The URL was still the placeholder because **CloudFront was serving the old cached version of `script.js`**.

### CloudFront Cache Invalidation

When you update a file in S3, CloudFront continues serving the cached version from its edge locations until the TTL expires (default: 24 hours for the CachingOptimized policy). You need to manually invalidate the cache to force a refresh:

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/script.js"
```

Or invalidate everything:

```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/*"
```

After the invalidation, I reloaded the page. New error.

---

## Step 2: The CORS Error

```
Access to fetch at 'https://abc123.execute-api.eu-north-1.amazonaws.com/prod/users?userId=1'
from origin 'https://d1234abcd.cloudfront.net' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

This is the most common error in serverless web app development. Let me explain exactly what is happening.

![The CORS error shown in the browser console](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-4/02-console-errors.png)
*The browser console blocking the request — no Access-Control-Allow-Origin header present.*

### What CORS Actually Is

CORS (Cross-Origin Resource Sharing) is a browser security mechanism. A browser will refuse to complete a request from `origin-A.com` to `origin-B.com` unless `origin-B.com` explicitly says "I allow requests from `origin-A.com`." It does this by returning an `Access-Control-Allow-Origin` header.

In our case:
- **Frontend origin:** `https://d1234abcd.cloudfront.net`
- **API origin:** `https://abc123.execute-api.eu-north-1.amazonaws.com`

These are different origins (different hostnames). The browser blocks the API call until the API starts returning the right headers.

**This is a browser-enforced mechanism.** CORS has no effect on server-to-server requests (curl, Postman, Lambda-to-Lambda). It only applies when a browser makes a cross-origin request. This is why your API worked fine in Postman but fails in the browser.

### The Two Places CORS Must Be Configured

With Lambda Proxy Integration, CORS must be configured in **two places**. Most tutorials only mention one of them.

**Place 1: API Gateway**

In API Gateway, you enable CORS on the resource. This handles the preflight `OPTIONS` request that the browser sends before the actual `GET`. Configure it with:

- `Access-Control-Allow-Origin: https://d1234abcd.cloudfront.net`
- `Access-Control-Allow-Methods: GET,OPTIONS`
- `Access-Control-Allow-Headers: Content-Type,Authorization`

**Place 2: Lambda function**

With proxy integration, API Gateway passes the raw Lambda response directly to the browser. It does not add any headers that are not in the Lambda response itself. So if your Lambda does not include CORS headers in its response, the browser gets a response without `Access-Control-Allow-Origin` and blocks it.

Your Lambda must return CORS headers on every response:

```javascript
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
```

The handler must also respond to `OPTIONS`:

```javascript
if (event.httpMethod === "OPTIONS") {
  return { statusCode: 200, headers: CORS_HEADERS, body: "" };
}
```

This is documented in the AWS docs but buried. The conceptual model to remember is: **API Gateway handles the preflight. Lambda handles the actual response headers.**

![Enabling CORS on the API Gateway resource](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-4/03-resolving-cors.png)
*Enabling CORS on the API Gateway resource — one of the two places it must be configured.*

### How Browser CORS Preflight Works

For any cross-origin request with a non-simple method or custom headers, the browser first sends an `OPTIONS` request:

```
OPTIONS /users HTTP/1.1
Host: abc123.execute-api.eu-north-1.amazonaws.com
Origin: https://d1234abcd.cloudfront.net
Access-Control-Request-Method: GET
Access-Control-Request-Headers: content-type
```

Your API must respond:

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://d1234abcd.cloudfront.net
Access-Control-Allow-Methods: GET,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
```

Only then does the browser proceed with the actual `GET` request. And that `GET` response must also include `Access-Control-Allow-Origin` or the browser blocks it even after the preflight succeeded.

---

## Step 3: Verifying End-to-End

After fixing both CORS locations, I:

1. Redeployed the API Gateway stage (changes to the resource CORS configuration require a new deployment)
2. Re-uploaded `script.js` to S3
3. Ran another CloudFront invalidation
4. Reloaded the CloudFront URL

Then typed `1` in the User ID field and clicked the button.

```json
{
  "userId": "1",
  "name": "Test User",
  "email": "test@example.com"
}
```

The Network tab showed:
- `OPTIONS /users` → 200 (preflight)
- `GET /users?userId=1` → 200 (actual request)

The full three-tier stack was working end-to-end.

![The working app with OPTIONS and GET both returning 200](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-4/04-fixed-solution.png)
*The fixed solution — OPTIONS and GET both return 200 and the user data renders.*

---

## Deployment Checklist

Here is the checklist I now follow whenever I update any component of this stack:

| Change | Actions required |
|--------|-----------------|
| Update `script.js` | Re-upload to S3, create CloudFront invalidation for `/script.js` |
| Update `index.html` | Re-upload to S3, create CloudFront invalidation |
| Update Lambda code | Deploy new function version (console or CLI) |
| Update Lambda env vars | No redeployment needed |
| Update API Gateway routes | Must create a new Deployment and associate with stage |
| Update IAM policies | Takes effect immediately |

The CloudFront invalidation step is the one people forget most often. After wondering why your changes are not showing up, run `aws cloudfront create-invalidation --paths "/*"` — that will usually be the fix.

---

## Architecture Decisions: What I Would Do Differently in Production

### 1. Use a Custom Domain

The CloudFront URL (`d1234abcd.cloudfront.net`) is not something you want in a production app. You would:
- Register a domain in Route 53 (or bring your own)
- Request an ACM certificate (free, in `us-east-1` for CloudFront)
- Add a CNAME alias to your CloudFront distribution
- Update the `ALLOWED_ORIGIN` env var on Lambda to your real domain
- Never use `"*"` for `Access-Control-Allow-Origin` in production

### 2. Lock Down CORS

In the code, `ALLOWED_ORIGIN` defaults to `"*"`. This is fine for development. In production, this should be your specific CloudFront domain. This ensures that other sites cannot trigger your API with a user's browser credentials.

### 3. Add Structured Logging

The current CloudWatch logs are unstructured strings. For a production API, I would use structured JSON logging:

```javascript
console.log(JSON.stringify({
  level: "info",
  userId,
  durationMs: Date.now() - startTime,
  found: !!result.Item
}));
```

This makes CloudWatch Logs Insights queries much more powerful.

### 4. Add a CloudWatch Alarm on Lambda Errors

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "LambdaErrorRate" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --dimensions Name=FunctionName,Value=three-tier-app-retrieve-user-data \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --period 60 \
  --statistic Sum \
  --alarm-actions arn:aws:sns:region:account:my-alert-topic
```

### 5. Deploy with Infrastructure as Code

The CloudFormation template in this repository (`infrastructure/cloudformation/three-tier-stack.yaml`) provisions the entire stack — S3, CloudFront, DynamoDB, Lambda, API Gateway, IAM — in a single command:

```bash
aws cloudformation deploy \
  --template-file infrastructure/cloudformation/three-tier-stack.yaml \
  --stack-name three-tier-app \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ProjectName=three-tier-app
```

Tearing it all down is equally simple:

```bash
aws cloudformation delete-stack --stack-name three-tier-app
```

This is one of the biggest operational advantages of IaC: reproducibility. You can spin up an identical copy of this environment in any region in minutes.

---

## What I Learned From This Series

1. **CORS is a browser mechanism, not an API mechanism.** It cannot be tested with curl alone. Always test from a browser when cross-origin requests are involved.

2. **CloudFront caching is aggressive by default.** Develop a habit of running cache invalidations after every frontend update, or use asset hashing (`main.abc123.js`) so updated files have new names and old ones can be cached forever.

3. **Least-privilege IAM is practical, not academic.** Scoping a Lambda role to `dynamodb:GetItem` on a specific table ARN takes three minutes and meaningfully reduces your blast radius.

4. **OAC is the correct way to serve S3 content via CloudFront.** There is no reason to make an S3 bucket public if CloudFront is in front of it.

5. **CloudFormation templates are their own documentation.** The template in this repository tells you exactly what was provisioned, how components relate to each other, and what every configuration choice was.

---

## Repository

Everything covered in this series is in the GitHub repository:

```
aws-three-tier-serverless/
├── frontend/          # index.html, style.css, script.js
├── backend/lambda/    # Lambda function code (Node.js ESM)
├── infrastructure/
│   ├── cloudformation/   # Full CloudFormation stack
│   ├── iam/              # IAM policy documents
│   └── s3-bucket-policy.json
└── docs/articles/     # This article series
```

**[aws-three-tier-serverless on GitHub](#)**

---

*Kehinde Abiuwa — AWS Certified Solutions Architect (Professional) | Microsoft AZ-305*

[LinkedIn](https://www.linkedin.com/in/kehinde-abiuwa-b68087247) | [Dev.to](https://dev.to/kehindeabiuwadotcom)*
