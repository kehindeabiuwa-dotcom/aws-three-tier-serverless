# Least-Privilege IAM for Lambda: Why I Replaced the AWS Managed Policy With My Own

> **Series:** Building a Three-Tier Serverless Web App on AWS — Part 3 of 4
>
> **Tags:** `aws` `iam` `dynamodb` `lambda` `security` `serverless`

---

There is a moment in almost every AWS tutorial where the author says "attach `AmazonDynamoDBFullAccess` to your Lambda role" and moves on.

I understand why. It is fast. It makes the tutorial work. And for a throwaway demo it probably does not matter.

But if you are building anything real, you have just handed your serverless function the keys to every DynamoDB table in your account — including the ability to delete them.

In this article, I want to do something slightly different. I will show you the **journey** I took: start with the broad managed policy that AWS recommends, understand why it is wrong for production, and then tighten it down to the minimum permissions the function actually needs. This is the most important security lesson I learned while building this three-tier app.

---

## Where We Are in the Series

This is Part 3 of a four-part series building a serverless web app on AWS:

| Part | Topic |
|------|-------|
| 1 | S3 + CloudFront (frontend delivery) |
| 2 | Lambda + API Gateway (the REST API) |
| **3** | **DynamoDB + Least-Privilege IAM (data tier + security)** |
| 4 | Wiring everything together |

In Part 2 we built a Lambda function that calls DynamoDB. We intentionally left IAM incomplete — the function would throw `AccessDenied` if you called it. This part fixes that properly.

---

## Step 1: Set Up the DynamoDB Table

The data tier is a single DynamoDB table named `UserData`.

**Table design:**

| Attribute | Type | Role |
|-----------|------|------|
| `userId` | String | Partition key |

That is the entire schema — because DynamoDB is schemaless. Each item can have whatever attributes you want. Only the partition key (`userId`) must be present.

**Why `userId` as the partition key?**

DynamoDB stores and retrieves items by their partition key. With `userId` as the key, looking up a specific user is an O(1) `GetItem` operation — constant time regardless of how many users are in the table. If we modelled this as a relational table and queried by a non-indexed column, we would be doing a full table scan.

**Capacity mode:** I used On-Demand (PAY_PER_REQUEST). No need to predict throughput. DynamoDB scales automatically and you pay only for what you use. For a production app with predictable traffic, Provisioned capacity with Auto Scaling is more cost-efficient.

![The UserData table in the DynamoDB console](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-3/01-dynamodb-setup.png)
*The UserData table created in DynamoDB with userId as the partition key.*

**Seed data:**

```json
{
  "userId": "1",
  "name": "Test User",
  "email": "test@example.com"
}
```

---

## Step 2: The First IAM Mistake (Intentional)

With the table created, I attached a permission policy to the Lambda execution role.

AWS shows you six DynamoDB-related managed policies. Two of them look like they are for Lambda + DynamoDB:

- `AWSLambdaDynamoDBExecutionRole`
- `AWSLambdaInvocation-DynamoDB`

**Do not use either of these.** They sound right but are designed for a completely different pattern — DynamoDB Streams, where DynamoDB pushes events to Lambda. They do not grant `dynamodb:GetItem` on a table. Attaching them does nothing for our use case.

![The DynamoDB managed policies shown when attaching permissions](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-3/02-iam-policy-selection.png)
*The DynamoDB-related managed policies AWS offers when attaching permissions to the role.*

So I attached `AmazonDynamoDBReadOnlyAccess` instead. And it worked. The Lambda could now retrieve user records.

But I was not done.

![Attaching the AmazonDynamoDBReadOnlyAccess managed policy](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-3/03-first-iam-mistake.png)
*The intentional first mistake — attaching the broad AmazonDynamoDBReadOnlyAccess managed policy.*

---

## Step 3: Understanding What `AmazonDynamoDBReadOnlyAccess` Actually Allows

Let me show you what this managed policy actually grants:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:BatchGetItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DescribeExport",
        "dynamodb:DescribeGlobalTable",
        "dynamodb:DescribeGlobalTableSettings",
        "dynamodb:DescribeImport",
        "dynamodb:DescribeKinesisStreamingDestination",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeTableReplicaAutoScaling",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:GetItem",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListContributorInsights",
        "dynamodb:ListExports",
        "dynamodb:ListGlobalTables",
        "dynamodb:ListImports",
        "dynamodb:ListStreams",
        "dynamodb:ListTables",
        "dynamodb:ListTagsOfResource",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:GetResourcePolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

That `"Resource": "*"` means every DynamoDB table in the account. And the action list includes `Scan` — which can read every item in every table. It also includes `ListTables`, `DescribeTable`, and more.

My Lambda function does exactly one thing: call `GetItem` on the `UserData` table. The gap between what the function needs and what this policy grants is enormous.

---

## Step 4: Writing the Least-Privilege Inline Policy

I replaced the managed policy with a custom inline policy scoped to exactly what the function needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBGetItemOnly",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:eu-north-1:123456789012:table/UserData"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:eu-north-1:123456789012:log-group:/aws/lambda/*"
    }
  ]
}
```

Two statements. That is all.

![The least-privilege inline policy in the IAM console](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-3/04-inline-policy.png)
*The custom inline policy scoped to dynamodb:GetItem on the UserData table only.*

1. `dynamodb:GetItem` — on the specific `UserData` table ARN only. No other tables. No other actions.
2. CloudWatch Logs — so the function can write its execution logs.

**Why an inline policy instead of a new managed policy?**

Inline policies are attached directly to the role and cannot be accidentally shared with another role. For narrow, function-specific permissions like this, inline is the right choice. Managed policies are better suited for shared, reusable permission sets (like "all Lambda functions need CloudWatch Logs access").

---

## Step 5: Validating the Change

After attaching the inline policy, I re-ran the Lambda test event:

```json
{ "userId": "1" }
```

Result:

```json
{
  "statusCode": 200,
  "body": "{\"email\":\"test@example.com\",\"name\":\"Test User\",\"userId\":\"1\"}"
}
```

Then I removed the managed policy. Tested again. Same result.

Then I deliberately tested an error case — a `userId` that does not exist in the table:

```json
{ "userId": "999" }
```

Result:

```json
{
  "statusCode": 404,
  "body": "{\"error\":\"No user found with userId: 999\"}"
}
```

And I checked CloudWatch Logs to confirm there were no `AccessDenied` errors anywhere.

![The Lambda test event returning a 200 with the user item](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/screenshots/part-3/05-final-validation.png)
*The Lambda test returning 200 with the user item — confirming the scoped policy works.*

---

## Why This Matters Beyond Theory

The principle of least privilege is not just a compliance checkbox. It has real security implications:

**Blast radius reduction:** If this Lambda function is ever exploited — through a code injection vulnerability, a dependency supply chain attack, or a misconfiguration — the attacker can only call `GetItem` on `UserData`. They cannot read your other tables, scan your entire database, or list your table names to understand your data model.

**Auditability:** When someone reads the IAM policy attached to this function, they immediately understand exactly what it does and what it can access. A `"Resource": "*"` with 25 actions tells you nothing about intent.

**Easier incident response:** If you get a security alert about unusual DynamoDB activity and you know the only thing that can touch `UserData` with `GetItem` is the `RetrieveUserData` Lambda, your investigation is much more focused.

---

## Common IAM Mistakes to Avoid

| Mistake | Why It Matters |
|---------|---------------|
| `"Resource": "*"` on data services | Grants access to every table/bucket/secret in the account |
| Using `FullAccess` managed policies for read-only functions | Allows writes and deletes your function will never need |
| Not scoping CloudWatch Logs to the function's log group | Allows the function to write to any log group |
| Attaching policies to users instead of roles | Violates the principle of using roles for service-to-service auth |
| Not removing unused permissions when code changes | Accumulated permissions that were once needed but no longer are |

---

## The DynamoDB Data Model — Key Concepts

Since we are in the data tier, it is worth briefly covering the DynamoDB concepts that matter here:

**Partition key (Hash key):** Determines which partition of DynamoDB's distributed storage your item lives on. Choose a partition key with high cardinality (many distinct values) to distribute load evenly. `userId` works well — each user has a unique ID.

**`GetItem` vs `Query` vs `Scan`:**

| Operation | Use case | Cost |
|-----------|----------|------|
| `GetItem` | Retrieve exactly one item by its primary key | 0.5 RCU per read |
| `Query` | Retrieve multiple items by partition key + sort key condition | Scales with result set |
| `Scan` | Read every item in the table | Expensive — avoid in production |

Our function uses `GetItem` with `userId` as the key. This is the most efficient possible read operation for this use case.

**On-demand vs Provisioned capacity:**

On-demand billing means DynamoDB handles scaling automatically. You pay per request. Good for unpredictable workloads. Provisioned capacity lets you set read/write capacity units and is cheaper at predictable, high volume. You can switch between modes once per 24 hours.

---

## What's Next

In the final part, we wire all three tiers together — connecting the CloudFront frontend to the API Gateway backend, solving the CORS issues that arise when your frontend and backend live on different domains, and invalidating the CloudFront cache after updating the frontend files.

**[Part 4 → Building the Complete Three-Tier Web App](#)**

---

## Architecture Diagram

![Part 3 architecture — Lambda to DynamoDB with the IAM policy as a boundary](https://raw.githubusercontent.com/kehindeabiuwa-dotcom/aws-three-tier-serverless/main/diagrams/part-3-dynamodb-iam.png)

---

*Code for this series: [aws-three-tier-serverless on GitHub](#)*

*Kehinde Abiuwa — AWS Certified Solutions Architect (Professional) | Microsoft AZ-305*
