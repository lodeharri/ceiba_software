/**
 * FrontendStack (PR 1, tasks.md §2 PR 1).
 *
 * Provisions:
 *   - Private S3 bucket for the SPA static bundle.
 *   - CloudFront distribution with Origin Access Control (OAC).
 *   - Default *.cloudfront.net certificate (ADR-8: no custom domain in MVP).
 *   - SPA fallback: 404 -> 200 /index.html (so client-side router takes over).
 *   - Response headers policy: CSP, X-Content-Type-Options, Referrer-Policy,
 *     X-Frame-Options (RISK-W01).
 *
 * Exports `distributionDomainName` so ApiStack can wire the CORS allow-origin
 * at synth time (RISK-002).
 *
 * No source files for the SPA live in this stack — the SPA is built by the
 * frontend package (PR 3) and uploaded to the bucket by a follow-up CDK
 * BucketDeployment construct. For PR 1 the bucket is empty; the
 * CloudFront distribution still serves a 404 -> index.html response.
 */

import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { type Stage, infraConfig } from '../config.js';

export interface FrontendStackProps extends StackProps {
  stage: Stage;
}

export class FrontendStack extends Stack {
  /** The CloudFront distribution's domain name (e.g. d111.cloudfront.net).
   *  Consumed by ApiStack to build the CORS allow-origin allow-list. */
  public readonly distributionDomainName: string;

  public constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Private S3 bucket — the SPA bundle is uploaded here. The bucket has
    // no public read; CloudFront reaches it via the OAC below.
    const bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `mercadoexpress-${stage}-spa-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // In dev the bucket is destroyed with the stack; in prod it survives
      // a stack delete (the SPA assets are valuable).
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    // Response headers policy — the security baseline per RISK-W01.
    // CSP itself is delivered via index.html (PR 3), but we set the
    // transport-level headers here so they are guaranteed even for
    // assets that bypass the document (e.g. direct asset loads).
    const securityHeadersPolicy = new cf.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `MercadoExpress-${stage}-SecurityHeaders`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cf.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.seconds(31536000),
          includeSubdomains: true,
          override: true,
        },
      },
    });

    // SPA fallback: every 404 (and 403) is rewritten to /index.html with
    // status 200, so the client-side router takes over the routing.
    const spaErrorResponses: cf.ErrorResponse[] = [
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      },
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      },
    ];

    // Origin Access Control — CloudFront uses this to sign requests to the
    // S3 bucket. The bucket policy below grants the OAC permission to read.
    const oac = new cf.S3OriginAccessControl(this, 'SpaOac');

    const distribution = new cf.Distribution(this, 'SpaDistribution', {
      comment: `MercadoExpress ${stage} SPA distribution (ADR-8: default cloudfront.net cert, no custom domain)`,
      defaultRootObject: 'index.html',
      errorResponses: spaErrorResponses,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      priceClass: cf.PriceClass.PRICE_CLASS_100, // US/EU only — cheapest for MVP
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket as s3.IBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeadersPolicy,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      },
    });

    this.distributionDomainName = distribution.distributionDomainName;

    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distributionDomainName,
      description: 'CloudFront distribution domain (CORS allow-origin for the API)',
      exportName: `MercadoExpress-${stage}-DistributionDomainName`,
    });
    new CfnOutput(this, 'SpaBucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket holding the SPA static bundle',
      exportName: `MercadoExpress-${stage}-SpaBucketName`,
    });

    // Reference `infraConfig` so the import isn't dropped; the project-wide
    // tags are applied by `cdk.Tags.of(app).add(...)` in `app.ts`.
    void infraConfig;
  }
}
