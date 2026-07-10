/**
 * JWT secret SSM constructs (PR 1, tasks.md §2 PR 1).
 *
 * Provisions two SSM SecureString parameters per stage:
 *   - /MercadoExpress/{stage}/jwt-secret       — current HS256 secret
 *   - /MercadoExpress/{stage}/jwt-secret-previous — previous HS256 secret
 *     (used during the rotation overlap window per design.md ADR-3)
 *
 * Both parameters use the AWS-managed CMK for SSM (`alias/aws/ssm`) so
 * there is no KMS cost in MVP. The initial values are placeholders; the
 * operations runbook (`runbook/rotate-admin-password.md`) rotates them.
 *
 * The dual-secret window is encoded in `JWT_OVERLAP_SECONDS` (default
 * 3600s = 1h) which the Lambda env carries.
 */

import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Stage } from '../config.js';

export interface JwtSecretPairProps {
  stage: Stage;
}

export class JwtSecretPair extends Construct {
  public readonly current: ssm.StringParameter;
  public readonly previous: ssm.StringParameter;

  public constructor(scope: Construct, id: string, props: JwtSecretPairProps) {
    super(scope, id);
    const { stage } = props;

    this.current = new ssm.StringParameter(this, 'Current', {
      parameterName: `/MercadoExpress/${stage}/jwt-secret`,
      stringValue: 'placeholder-replaced-by-ops',
      description: `MercadoExpress ${stage} JWT HS256 secret (current). Rotate via runbook/rotate-admin-password.md.`,
      type: ssm.ParameterType.SECURE_STRING,
    });

    this.previous = new ssm.StringParameter(this, 'Previous', {
      parameterName: `/MercadoExpress/${stage}/jwt-secret-previous`,
      stringValue: 'placeholder-empty-on-first-deploy',
      description: `MercadoExpress ${stage} JWT HS256 secret (previous). Set when rotating via the runbook; cleared after the overlap window.`,
      type: ssm.ParameterType.SECURE_STRING,
    });
  }
}
