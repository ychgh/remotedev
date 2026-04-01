#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RemoteDevStack } from '../lib/remotedev-stack';

const app = new cdk.App();

new RemoteDevStack(app, 'RemoteDevStack', {
  /* Uncomment and set to your target account / region for a concrete deployment:
   *   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
   *
   * Pass context values at deploy time with -c, for example:
   *   npx cdk deploy -c keyName=my-key-pair -c allowedSshCidr=1.2.3.4/32
   */
  description:
    'Cloud-based remote developer workstation (≥8 vCPUs, ≥32 GiB RAM, Ubuntu 22.04) ' +
    'compatible with VS Code Remote SSH / Tunnels and JetBrains Gateway.',
});
