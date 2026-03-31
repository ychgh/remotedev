import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * RemoteDevStack provisions a cloud-based developer workstation on EC2 that
 * supports VS Code Remote SSH, VS Code Remote Tunnels, and JetBrains Gateway.
 *
 * The source code, tools, containers and runtimes live on the instance while
 * you use your local VS Code or JetBrains client as the UI.
 *
 * CDK context keys (pass with -c key=value or in cdk.context.json):
 *   keyName        - (optional) Name of an existing EC2 Key Pair for SSH access.
 *                    If omitted, AWS Systems Manager Session Manager can still be
 *                    used to access the instance.
 *   allowedSshCidr - IPv4 CIDR allowed to reach port 22. Default: 0.0.0.0/0.
 *                    Restrict this to your IP for better security.
 *   instanceType   - EC2 instance type. Default: m5.2xlarge (8 vCPUs, 32 GiB RAM).
 */
export class RemoteDevStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Context parameters ────────────────────────────────────────────────────
    const keyName = this.node.tryGetContext('keyName') as string | undefined;
    const allowedSshCidr =
      (this.node.tryGetContext('allowedSshCidr') as string | undefined) ??
      '0.0.0.0/0';
    const instanceTypeStr =
      (this.node.tryGetContext('instanceType') as string | undefined) ??
      'm5.2xlarge'; // 8 vCPUs, 32 GiB RAM — minimum requirement

    // ── VPC ───────────────────────────────────────────────────────────────────
    // Single public subnet; no NAT gateway needed (instance has an Elastic IP).
    const vpc = new ec2.Vpc(this, 'RemoteDevVpc', {
      maxAzs: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
      natGateways: 0,
    });

    // ── Security group ────────────────────────────────────────────────────────
    const securityGroup = new ec2.SecurityGroup(this, 'RemoteDevSG', {
      vpc,
      description: 'Remote dev environment – allow SSH inbound',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      ec2.Peer.ipv4(allowedSshCidr),
      ec2.Port.tcp(22),
      'SSH access',
    );

    // ── IAM role ──────────────────────────────────────────────────────────────
    // AmazonSSMManagedInstanceCore lets you use Session Manager as an
    // alternative to SSH (no open inbound port required).
    const role = new iam.Role(this, 'RemoteDevRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      ],
    });

    // ── Ubuntu 22.04 LTS AMI ──────────────────────────────────────────────────
    // Uses the Canonical SSM parameter so the latest patched AMI is always used.
    const machineImage = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
      { os: ec2.OperatingSystemType.LINUX },
    );

    // ── User data ─────────────────────────────────────────────────────────────
    // Installs common developer tools on first boot.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      '',
      '# System update',
      'apt-get update -y',
      'apt-get upgrade -y',
      '',
      '# Core dev tools',
      'apt-get install -y git curl wget unzip zip build-essential ca-certificates gnupg lsb-release python3 python3-pip python3-venv',
      '',
      '# Docker (official repo)',
      'install -m 0755 -d /etc/apt/keyrings',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
      'chmod a+r /etc/apt/keyrings/docker.gpg',
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null',
      'apt-get update -y',
      'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
      'usermod -aG docker ubuntu',
      '',
      '# nvm + Node.js (LTS) for the ubuntu user',
      'sudo -u ubuntu bash -c \'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && source ~/.nvm/nvm.sh && nvm install --lts\'',
      '',
      '# Signal successful completion',
      '/opt/aws/bin/cfn-signal -e $? --stack ' +
        cdk.Stack.of(this).stackName +
        ' --region ' +
        cdk.Stack.of(this).region +
        ' --resource RemoteDevInstance || true',
    );

    // ── EC2 instance ──────────────────────────────────────────────────────────
    const instance = new ec2.Instance(this, 'RemoteDevInstance', {
      vpc,
      instanceType: new ec2.InstanceType(instanceTypeStr),
      machineImage,
      securityGroup,
      role,
      userData,
      // SSH key pair – omit to rely solely on Session Manager
      ...(keyName
        ? {
            keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', keyName),
          }
        : {}),
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(100, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      requireImdsv2: true,
    });

    // ── Elastic IP ────────────────────────────────────────────────────────────
    // Provides a stable public address that survives stop/start cycles.
    const eip = new ec2.CfnEIP(this, 'RemoteDevEIP', {
      domain: 'vpc',
    });

    new ec2.CfnEIPAssociation(this, 'RemoteDevEIPAssociation', {
      instanceId: instance.instanceId,
      allocationId: eip.attrAllocationId,
    });

    // ── Stack outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'ElasticIp', {
      value: eip.ref,
      description: 'Stable Elastic IP address of the dev instance',
    });

    new cdk.CfnOutput(this, 'SshCommand', {
      value: keyName
        ? `ssh -i ${keyName}.pem ubuntu@${eip.ref}`
        : `# No key pair specified – use Session Manager: aws ssm start-session --target ${instance.instanceId}`,
      description: 'SSH command to connect to the instance',
    });

    new cdk.CfnOutput(this, 'VsCodeRemoteSshTarget', {
      value: `ubuntu@${eip.ref}`,
      description:
        'Use this as the Remote SSH target in VS Code (add to ~/.ssh/config as HostName)',
    });

    new cdk.CfnOutput(this, 'JetBrainsGatewayTarget', {
      value: `ubuntu@${eip.ref}`,
      description:
        'Use this as the SSH connection target in JetBrains Gateway',
    });
  }
}
