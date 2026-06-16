# Lucidchart Diagram Specs — Three-Tier Serverless Web App

This document tells you exactly what to draw in Lucidchart for each article.
Use the **AWS Architecture 2021** shape library in Lucidchart (search for "AWS" in the shape panel).

---

## Global Style Guide (apply to all diagrams)

| Element | Style |
|---------|-------|
| Background | White or very light grey (#F8F9FA) |
| Font | Arial or Helvetica, 12pt |
| Tier containers | Rounded rectangle, light colour fill, dashed border |
| Presentation tier container | Light blue fill (#E3F2FD) |
| Logic tier container | Light orange fill (#FFF3E0) |
| Data tier container | Light green fill (#E8F5E9) |
| Security/IAM elements | Light red fill (#FFEBEE), dashed border |
| Arrows | Dark grey (#333), 1.5pt, directional |
| Labels on arrows | Italic, small (10pt) |

---

## Diagram 1 — Part 1: S3 + CloudFront (Presentation Tier)

**Title:** "Delivering a Static Website with CloudFront and Origin Access Control"

### Shapes to Draw (left to right)

1. **User / Browser** (AWS Internet icon or a simple laptop icon)
   - Label: "User"

2. **Arrow** →
   - Label: "HTTPS request"

3. **Amazon CloudFront** (use AWS CloudFront shape)
   - Label: "Amazon CloudFront\nDistribution\n(Edge Location)"
   - Inside or nearby: small note "Redirect HTTP → HTTPS\nCachingOptimized policy\nDefault root: index.html"

4. **Arrow** →
   - Label: "SigV4 signed\nrequest (OAC)"

5. **Amazon S3** (use AWS S3 shape)
   - Label: "S3 Bucket\n(private)\nBlock All Public Access: ON"
   - Inside: list "index.html\nstyle.css\nscript.js"

6. **IAM / Security note** (small box with dashed border, below or beside the arrow between CloudFront and S3)
   - Label: "Bucket Policy:\nPrincipal: cloudfront.amazonaws.com\nCondition: AWS:SourceArn =\n  arn:aws:cloudfront::ACCOUNT:distribution/ID"

7. **Arrow back** ←
   - Label: "Object returned\n(cached at edge)"

### Annotations to add

- Red X icon next to S3: "Direct S3 URL → 403 AccessDenied"
- Green checkmark next to CloudFront: "CloudFront URL → 200 OK"

### Layout
Left-to-right flow. Put the S3 bucket inside a container labelled "Presentation Tier" with the light blue background.

---

## Diagram 2 — Part 2: Lambda + API Gateway (Logic Tier)

**Title:** "Serverless REST API: API Gateway + Lambda Proxy Integration"

### Shapes to Draw

1. **User / Browser**
   - Label: "User (Browser)"
   - Small note: "Same origin as CloudFront\nGET /users?userId=1"

2. **Arrow** →
   - Label: "GET /users?userId=1\nHTTPS"

3. **Amazon API Gateway** (use AWS API Gateway shape)
   - Label: "API Gateway\nREST API\n/prod stage"
   - Inside: "/users\n  GET → Lambda\n  OPTIONS → Mock (CORS)"

4. **Arrow** →
   - Label: "Lambda Proxy\nInvocation (JSON event)"

5. **AWS Lambda** (use AWS Lambda shape)
   - Label: "RetrieveUserData\nNode.js 22 / ESM\nRuntime: 128 MB / 10s timeout"
   - Inside: "event.queryStringParameters.userId\n→ GetItem\n← JSON response"

6. **IAM Role** (small box, below Lambda)
   - Label: "Execution Role\n✓ dynamodb:GetItem (UserData ARN)\n✓ logs:PutLogEvents (/aws/lambda/*)"
   - Style: dashed red border

7. **Arrow (dashed)** → (from Lambda towards right, not yet connected)
   - Label: "→ DynamoDB\n(Part 3)"
   - Style: greyed out to show it is coming next

8. **Amazon CloudWatch** (small, below Lambda)
   - Label: "CloudWatch Logs\n/aws/lambda/RetrieveUserData"
   - Arrow from Lambda: dashed, labelled "Execution logs"

### Annotations to add

- Note box: "Lambda Proxy Integration:\nAPI GW passes full HTTP request as JSON event\nLambda must return: statusCode, headers, body"
- Note box: "Stages:\n/dev — testing\n/prod — live traffic"

### Layout
Left-to-right. Put API Gateway + Lambda inside container labelled "Logic Tier" with light orange background. IAM role floats below with dashed border.

---

## Diagram 3 — Part 3: DynamoDB + IAM (Data Tier + Security)

**Title:** "Least-Privilege IAM: Scoping Lambda to a Single DynamoDB Table and Action"

### This diagram has two parts: the data flow AND the IAM policy comparison

### Part A — Data Flow

1. **AWS Lambda** (RetrieveUserData)

2. **Arrow** →
   - Label: "dynamodb:GetItem\nKey: { userId: "1" }"

3. **Amazon DynamoDB** (use AWS DynamoDB shape)
   - Label: "UserData Table\nPartition key: userId (String)\nCapacity: On-Demand\nSSE: Enabled"
   - Inside (as a small table): "userId | name | email\n"1" | Test User | test@example.com"

4. **Arrow** ←
   - Label: "{ userId, name, email }"

### Part B — IAM Policy Comparison (side by side, below)

**Box 1 (red/bad):**
```
AmazonDynamoDBReadOnlyAccess (managed)
Action: 20+ actions including Scan, Query, List
Resource: * (ALL tables in account)
```
Label: "❌ Too broad"

**Box 2 (green/good):**
```
Custom Inline Policy
Action: dynamodb:GetItem ONLY
Resource: arn:aws:dynamodb:REGION:ACCOUNT:table/UserData
```
Label: "✅ Least Privilege"

Arrow between them with label: "Replaced with"

### Annotations to add

- Note: "GetItem vs Scan vs Query" comparison table
- Note: "Blast radius: if this Lambda is compromised, attacker can only call GetItem on UserData. Nothing else."

### Layout
Top section: Lambda → DynamoDB flow (left to right).
Bottom section: two-column IAM comparison.
Surround DynamoDB in container labelled "Data Tier" with light green background.

---

## Diagram 4 — Part 4: Full Three-Tier Architecture (Complete Picture)

**Title:** "Complete Three-Tier Serverless Web App on AWS"

**This is the most important diagram — use it as the hero image for Part 4 and the README.**

### Shapes to Draw (top to bottom or left to right in three tiers)

#### Tier 1 — Presentation (top, light blue container)
- **Browser** (laptop icon)
- **Arrow** → "HTTPS"
- **CloudFront** shape, labelled "CloudFront\n(CDN + HTTPS + Cache)"
- **Arrow** → "OAC / SigV4"
- **S3 Bucket** (private), labelled "S3\n[index.html\nstyle.css\nscript.js]"
- Small note: "Block All Public Access: ON"

#### Tier 2 — Logic (middle, light orange container)
- **API Gateway** shape, labelled "API Gateway\nREST API /prod\nGET /users"
- **Arrow** → "Lambda Proxy"
- **Lambda** shape, labelled "Lambda\nRetrieveUserData"
- Small **IAM Role** box below Lambda, labelled "IAM Role\ndynamodb:GetItem"
- Small **CloudWatch** icon below Lambda, labelled "Logs"

#### Tier 3 — Data (bottom or right, light green container)
- **DynamoDB** shape, labelled "DynamoDB\nUserData\n(On-Demand · SSE)"

#### Connecting arrows between tiers
- Browser → CloudFront: "HTTPS request"
- CloudFront → S3: "OAC (SigV4 signed)"
- Browser → API Gateway: "GET /users?userId=1\n(from script.js)"
- API Gateway → Lambda: "JSON event (proxy)"
- Lambda → DynamoDB: "GetItem { userId }"
- DynamoDB → Lambda: "{ userId, name, email }"
- Lambda → API Gateway: "{ statusCode: 200, body: JSON }"
- API Gateway → Browser: "200 OK + CORS headers"

#### CORS callout (between Browser and API Gateway)
- Small note box: "CORS required:\n1. API Gateway (OPTIONS preflight)\n2. Lambda response headers\n   Access-Control-Allow-Origin:\n   https://[cloudfront-domain]"

### Annotations to add

- Security badge: "No EC2 · No servers to manage · Scales to zero"
- At the top right: "CloudFormation: deploy entire stack with one command"

### Layout
Either three horizontal bands (top/middle/bottom) or a left-to-right flow with tier labels on the left. The three-band layout is cleaner and easier to read for a blog post header image.

**Recommended Lucidchart canvas size:** 1400 × 900 px

---

## Tips for Lucidchart

1. **AWS Shape Library:** In the left panel, click "+" → "Search shapes" → type "AWS" → enable the "AWS Architecture 2021" library.
2. **Containers:** Use Insert → Container to draw the tier boxes. Lock the container and put shapes inside it.
3. **Export:** Export as PNG at 2x resolution for crisp display in articles. Export as SVG for the GitHub README.
4. **Colour Palette:**
   - AWS Orange: `#FF9900`
   - Presentation tier: `#E3F2FD` (light blue)
   - Logic tier: `#FFF3E0` (light orange)
   - Data tier: `#E8F5E9` (light green)
   - Security/IAM: `#FFEBEE` (light red)
5. **Where to place diagrams in articles:**
   - Part 1: Use Diagram 1 as the hero image (top of article) and the architecture section
   - Part 2: Use Diagram 2
   - Part 3: Use Diagram 3
   - Part 4: Use Diagram 4 (the full picture) as the hero image — this is your strongest visual
   - README: Use Diagram 4, export as PNG, upload to the repo, reference in README
