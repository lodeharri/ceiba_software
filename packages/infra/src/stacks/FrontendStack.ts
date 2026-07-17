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
 *   - Second CloudFront behavior: `/api/*` → API Gateway (F-004 fix).
 *     The API Gateway hostname is derived from the import of
 *     `MercadoExpress-${stage}-HttpApiUrl` via Fn.importValue, then
 *     parsed with Fn.split to extract the hostname for HttpOrigin.
 *   - BucketDeployment: uploads `packages/frontend/dist/` to S3 at synth time.
 *   - Synth-time rebuild: rewrites `.env.production` with relative API URL
 *     (`VITE_API_BASE_URL=/api/v1`) and runs `vite build` so the bundle
 *     baked-in value matches the CloudFront routing (F-004).
 *
 * Does NOT export distributionDomainName to avoid a cross-stack cycle with
 * ApiStack (which would create a cyclic reference when Fn.importValue
 * of HttpApiUrl is also used from this stack).
 */

import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy, Fn } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as url from 'node:url';
import { execSync } from 'node:child_process';
import { type Stage, infraConfig } from '../config.js';

export interface FrontendStackProps extends StackProps {
  stage: Stage;
}

export class FrontendStack extends Stack {
  public constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ── Synth-time frontend rebuild (F-004) ────────────────────────────────────
    // import.meta.url for dist/src/stacks/FrontendStack.js:
    //   dist/src/stacks -> dist/src -> dist -> packages/infra -> packages -> workspace-root
    //   = 5 '..' segments to reach the workspace root.
    const rootDir = path.resolve(
      path.dirname(url.fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '..',
    );
    const frontendDir = path.join(rootDir, 'packages', 'frontend');
    const envProductionPath = path.join(frontendDir, '.env.production');
    const envProductionContent = 'VITE_API_BASE_URL=/api/v1\n';
    if (
      !fs.existsSync(envProductionPath) ||
      fs.readFileSync(envProductionPath, 'utf8') !== envProductionContent
    ) {
      fs.writeFileSync(envProductionPath, envProductionContent, 'utf8');
    }
    try {
      execSync('pnpm --filter frontend build', {
        cwd: rootDir,
        stdio: 'pipe',
      });
    } catch (err) {
      throw new Error(`Frontend build failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // ── Private S3 bucket ─────────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `mercadoexpress-${stage}-spa-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    // ── Response headers policy ────────────────────────────────────────────────
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

    const defaultBehavior: cf.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket as s3.IBucket, {
        originAccessControl: oac,
      }),
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      responseHeadersPolicy: securityHeadersPolicy,
      allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
    };

    // Build the CloudFront distribution props. The second behavior for /api/*
    // routes to the API Gateway. The API Gateway endpoint URL is imported via
    // Fn.importValue from the ApiStack output, and we parse it with Fn.split
    // to extract just the hostname for HttpOrigin.
    const distributionProps: cf.DistributionProps = {
      comment: `MercadoExpress ${stage} SPA distribution (ADR-8: default cloudfront.net cert, no custom domain)`,
      defaultRootObject: 'index.html',
      errorResponses: spaErrorResponses,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior,
    };

    // Add second CloudFront behavior for /api/* → API Gateway (F-004 fix).
    // Fn.importValue('MercadoExpress-${stage}-HttpApiUrl') returns the full URL.
    // Fn.split('://', ...) splits on '://', returning ['https', 'hostname/path'].
    // Fn.select(1, ...) takes the hostname/path part.
    // This avoids importing a CDK token string in FrontendStack, preventing
    // a cross-stack reference cycle with ApiStack.
    const apiEndpointFull = Fn.importValue(`MercadoExpress-${stage}-HttpApiUrl`);
    const apiHostnameWithPath = Fn.select(1, Fn.split('://', apiEndpointFull));
    const apiOrigin = new HttpOrigin(apiHostnameWithPath, {
      originPath: '',
      protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
    });
    // Custom Origin Request Policy: pass Authorization + other request
    // headers to the API Gateway origin. Without this CloudFront strips
    // them and the API returns 401 (FIX: F-006 CloudFront auth passthrough).
    const apiOriginRequestPolicy = new cf.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      originRequestPolicyName: `MercadoExpress-${stage}-ApiOriginRequestPolicy`,
      // Authorization header is automatically forwarded when
      // cachePolicy: CachingDisabled is set (CDK 2.113+ rejects it in
      // allowList). Only forward the custom app headers explicitly.
      headerBehavior: cf.OriginRequestHeaderBehavior.allowList(
        'Content-Type',
        'Idempotency-Key',
        'X-Request-Id',
      ),
      queryStringBehavior: cf.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cf.OriginRequestCookieBehavior.none(),
    });

    (
      distributionProps as cf.DistributionProps & {
        additionalBehaviors: Record<string, cf.BehaviorOptions>;
      }
    )['additionalBehaviors'] = {
      '/api/*': {
        origin: apiOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_ALL,
        cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        originRequestPolicy: apiOriginRequestPolicy,
        // Never cache authenticated endpoints — each user sees their own data.
        // Custom Cache Policy: pass Authorization header to origin. CachingDisabled
        // (managed) does not forward Authorization by default, so we build a custom one.
        // No caching because the backend returns per-user data.
        cachePolicy: new cf.CachePolicy(this, 'ApiCachePolicy', {
          cachePolicyName: `MercadoExpress-${stage}-ApiCachePolicy`,
          defaultTtl: Duration.seconds(0),
          minTtl: Duration.seconds(0),
          maxTtl: Duration.seconds(0),
          enableAcceptEncodingGzip: false,
          enableAcceptEncodingBrotli: false,
          cookieBehavior: cf.CacheCookieBehavior.none(),
          queryStringBehavior: cf.CacheQueryStringBehavior.none(),
          headerBehavior: cf.CacheHeaderBehavior.allowList('Authorization'),
        }),
      },
    };

    const distribution = new cf.Distribution(
      this,
      'SpaDistribution',
      distributionProps as cf.DistributionProps & {
        additionalBehaviors: Record<string, cf.BehaviorOptions>;
      },
    );

    // ── BucketDeployment ───────────────────────────────────────────────────────
    // Upload the freshly-built frontend dist to S3 (F-002 fix).
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(frontendDir, 'dist'))],
      destinationBucket: bucket as s3.IBucket,
      distribution,
      distributionPaths: ['/index.html', '/assets/*'],
    });

    // Export the CloudFront domain name as a CFN output so ApiStack can
    // reference it as a cross-stack prop. This export is resolved at
    // synth time (not at app.ts construction time), breaking the cycle.
    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
      exportName: `MercadoExpress-${stage}-DistributionDomainName`,
    });

    // Reference `infraConfig` so the import isn't dropped.
    void infraConfig;
  }
}
