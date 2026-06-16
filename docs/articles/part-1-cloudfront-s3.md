# How I Delivered a Static Website Globally with Amazon S3 and CloudFront (And the Security Mistake I Almost Made)

> **Series:** Building a Three-Tier Serverless Web App on AWS — Part 1 of 4
>
> **Tags:** `aws` `cloudfront` `s3` `cloud` `devops`

---

There is a very common shortcut that thousands of developers take when they want to host a static website on AWS. They create an S3 bucket, turn on "Static Website Hosting," flip off "Block Public Access," add a public-read bucket policy, and call it done.

It works. The site loads. But you have just made your S3 bucket publicly listable to anyone on the internet.

In this article — the first in a four-part series where I build a production-grade serverless web app on AWS — I am going to show you the right way to do it. We will use Amazon CloudFront as the delivery layer and configure Origin Access Control (OAC) so the S3 bucket stays completely private, while users still get a fast, HTTPS-secured experience from edge locations around the world.

---

## What We Are Building in This Series

By the end of Part 4, we will have a working three-tier web application:

| Tier | Services |
|------|----------|
| Presentation (frontend) | Amazon S3 + Amazon CloudFront |
| Logic (backend API) | AWS Lambda + Amazon API Gateway |
| Data | Amazon DynamoDB |

This first part covers the **presentation tier** — getting the frontend hosted and delivered globally.

---

## The Architecture

```
User's Browser
      │
      ▼
Amazon CloudFront  ──────────────────────────────────
  (Edge Location)                                    │ OAC (SigV4 signed)
      │                                              ▼
      │                                      Amazon S3 Bucket
      │                                      (private, Block All Public Access ON)
      │◄── cached hit (no S3 call needed) ──────────┘
```

The key insight is this: **CloudFront is the only entity that can read from the S3 bucket.** The bucket never needs to be public. This is enforced through Origin Access Control — a feature that makes CloudFront sign every request to S3 using AWS Signature Version 4, and a bucket policy that only permits requests that carry your specific distribution's ARN.

---

## Step 1 — Create the S3 Bucket and Upload Your Files

I created an S3 bucket and uploaded three files:

- `index.html` — the page markup
- `style.css` — styling
- `script.js` — JavaScript that will eventually call our API

**Critical: do not touch the Block Public Access settings.** Leave them all on. We will not need them off.

---

## Step 2 — Create the CloudFront Distribution

In the CloudFront console, I created a new distribution with these settings:

| Setting | Value | Why |
|---------|-------|-----|
| Origin domain | S3 bucket (regional domain) | Use the regional domain, NOT the S3 website endpoint |
| Origin access | Origin Access Control (new OAC) | This is what keeps the bucket private |
| Default root object | `index.html` | So the root URL `/` serves the page |
| Viewer protocol policy | Redirect HTTP to HTTPS | Force TLS at the edge |
| Cache policy | CachingOptimized | AWS-managed policy tuned for S3 origins |
| HTTP versions | HTTP/2 | Multiplexing reduces page load time |

**Why the regional domain and not the S3 website endpoint?**

The S3 website endpoint (`your-bucket.s3-website.region.amazonaws.com`) does not support OAC. If you set it as your CloudFront origin, you are forced to make the bucket publicly readable. The S3 regional domain (`your-bucket.s3.region.amazonaws.com`) is what you need.

---

## Step 3 — Set Up Origin Access Control

After creating the distribution, CloudFront shows you a banner: *"Update S3 bucket policy."* Copy the generated policy. It looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE"
        }
      }
    }
  ]
}
```

The `Condition` block is the important part. It locks the permission down to **your specific distribution** — not just any CloudFront distribution in the world. Even another distribution pointing at the same bucket would be rejected.

Go to S3 → your bucket → Permissions → Bucket Policy → paste it in and save.

---

## The Error I Hit (and Why You Will Too)

When I first set up the distribution, I left the origin access setting as *Public*. I thought: CloudFront is in front, so surely it can just read the bucket?

No. CloudFront fetches from S3 as an unauthenticated request when origin access is set to Public. If Block Public Access is on (which it should be), S3 returns a 403 AccessDenied. The CloudFront distribution just serves that 403 to your users.

The sequence of events that broke things:

1. Distribution set to Public origin → CloudFront makes unsigned GET request to S3
2. S3 sees no auth, checks bucket policy → no permission granted to anonymous principal
3. S3 returns `403 AccessDenied`
4. CloudFront serves the 403 to the user

After switching to OAC and updating the bucket policy:

1. CloudFront makes SigV4-signed GET request with distribution ARN attached
2. S3 checks bucket policy → sees `cloudfront.amazonaws.com` principal + correct ARN → allows `s3:GetObject`
3. S3 returns the file
4. CloudFront caches it at the edge and serves it to the user

---

## Step 4 — Understanding CloudFront Caching

Once the site was live, I ran a comparison between CloudFront delivery and the S3 website endpoint (which I temporarily enabled with a public-read policy just for benchmarking).

**CloudFront was meaningfully faster** — especially on repeat visits, where it served assets directly from the edge cache with no trip to S3 at all.

Here is why:

- **Geographic proximity:** CloudFront has over 450 edge locations globally. Instead of your user in Lagos hitting an S3 bucket in `eu-north-1`, they get the response from the nearest edge node.
- **HTTP/2 multiplexing:** Multiple assets (HTML, CSS, JS) download in parallel over a single connection.
- **Compression:** CloudFront automatically compresses with Gzip/Brotli.
- **Cache hits:** On a cache hit, S3 is never contacted. The latency is effectively the edge-to-user round trip only.

**TTLs and Cache Invalidation**

The CachingOptimized policy sets a default TTL of 86,400 seconds (24 hours). This means if you upload a new `index.html`, users may see the old version for up to 24 hours unless you run a CloudFront invalidation:

```bash
aws cloudfront create-invalidation \
  --distribution-id EDFDVBD6EXAMPLE \
  --paths "/*"
```

In production, you would version your assets (`main.abc123.js`) so CloudFront can cache them indefinitely and only invalidate `index.html` itself when a new deploy goes out.

---

## S3 Static Hosting vs CloudFront — When to Use Each

| | S3 Website Endpoint | CloudFront + OAC |
|---|---|---|
| HTTPS | No (HTTP only) | Yes (always) |
| Bucket can be private | No | Yes |
| Global edge caching | No | Yes |
| Custom domain + ACM | No | Yes |
| WAF / DDoS protection | No | Yes (AWS Shield) |
| Signed URLs / Cookies | No | Yes |
| Setup complexity | Low | Medium |

**S3 static hosting is fine for:** a quick local demo, a throw-away prototype, or if you are the only person accessing it.

**CloudFront is non-negotiable for:** anything user-facing, anything requiring HTTPS, anything global, anything you care about securing properly.

---

## What's Next

In Part 2, we will build the logic tier: a Lambda function that queries DynamoDB and an API Gateway REST API that exposes it to the world. We will deal with IAM permissions, proxy integration, stages, and the CORS issues that show up the moment your frontend tries to call your API.

**[Part 2 → APIs with Lambda + API Gateway](#)**

---

## Architecture Diagram

*[Include Lucidchart diagram here showing: Browser → CloudFront Edge → OAC → S3 Bucket (private)]*

---

*All code for this series is available on GitHub: [aws-three-tier-serverless](#)*

*Kehinde Abiuwa — AWS Certified Solutions Architect (Professional) | Microsoft AZ-305*
