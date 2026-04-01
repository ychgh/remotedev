import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { RemoteDevStack } from '../lib/remotedev-stack';

function makeTemplate(context: Record<string, string> = {}): Template {
  const app = new cdk.App({ context });
  const stack = new RemoteDevStack(app, 'TestStack');
  return Template.fromStack(stack);
}

describe('RemoteDevStack', () => {
  describe('EC2 Instance', () => {
    test('creates an EC2 instance with the default m5.2xlarge instance type', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 'm5.2xlarge',
      });
    });

    test('uses the Ubuntu 22.04 SSM parameter as the AMI source', () => {
      const template = makeTemplate();
      // CDK encodes the SSM path into the logical ID; dots are stripped so
      // "22.04" becomes "2204" in the synthesised Ref name.
      template.hasResourceProperties('AWS::EC2::Instance', {
        ImageId: {
          Ref: Match.stringLikeRegexp('SsmParameterValueaws.*canonical.*ubuntu.*2204'),
        },
      });
    });

    test('honours the instanceType context override', () => {
      const template = makeTemplate({ instanceType: 'm6i.4xlarge' });
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 'm6i.4xlarge',
      });
    });

    test('attaches an IAM instance profile', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::Instance', {
        IamInstanceProfile: Match.anyValue(),
      });
    });

    test('requires IMDSv2 (metadata service hardening)', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: {
          MetadataOptions: {
            HttpTokens: 'required',
          },
        },
      });
    });
  });

  describe('Root EBS volume', () => {
    test('provisions a 100 GiB gp3 root volume', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::Instance', {
        BlockDeviceMappings: Match.arrayWith([
          Match.objectLike({
            DeviceName: '/dev/sda1',
            Ebs: Match.objectLike({
              VolumeSize: 100,
              VolumeType: 'gp3',
            }),
          }),
        ]),
      });
    });

    test('encrypts the root volume', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::Instance', {
        BlockDeviceMappings: Match.arrayWith([
          Match.objectLike({
            Ebs: Match.objectLike({ Encrypted: true }),
          }),
        ]),
      });
    });
  });

  describe('Security group', () => {
    test('allows SSH (port 22) from 0.0.0.0/0 when a keyName is provided', () => {
      const template = makeTemplate({ keyName: 'my-key' });
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            FromPort: 22,
            ToPort: 22,
            IpProtocol: 'tcp',
            CidrIp: '0.0.0.0/0',
          }),
        ]),
      });
    });

    test('does not open port 22 when neither keyName nor allowedSshCidr is set', () => {
      const template = makeTemplate();
      const sg = template.findResources('AWS::EC2::SecurityGroup');
      const ingress = (Object.values(sg)[0] as any).Properties
        ?.SecurityGroupIngress;
      // No SSH ingress rules should be present at all
      expect(
        (ingress ?? []).some((r: any) => r.FromPort === 22),
      ).toBe(false);
    });

    test('honours the allowedSshCidr context override', () => {
      const template = makeTemplate({ allowedSshCidr: '10.0.0.1/32' });
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            FromPort: 22,
            CidrIp: '10.0.0.1/32',
          }),
        ]),
      });
    });

    test('allows all outbound traffic', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        SecurityGroupEgress: Match.arrayWith([
          Match.objectLike({
            CidrIp: '0.0.0.0/0',
            IpProtocol: '-1',
          }),
        ]),
      });
    });
  });

  describe('IAM role', () => {
    test('grants AmazonSSMManagedInstanceCore for Session Manager access', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('AmazonSSMManagedInstanceCore'),
              ]),
            ]),
          }),
        ]),
      });
    });

    test('trusts the ec2.amazonaws.com service principal', () => {
      const template = makeTemplate();
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'ec2.amazonaws.com' },
              Action: 'sts:AssumeRole',
            }),
          ]),
        }),
      });
    });
  });

  describe('Elastic IP', () => {
    test('allocates exactly one Elastic IP in the vpc domain', () => {
      const template = makeTemplate();
      template.resourceCountIs('AWS::EC2::EIP', 1);
      template.hasResourceProperties('AWS::EC2::EIP', { Domain: 'vpc' });
    });

    test('creates an EIP association to the instance', () => {
      const template = makeTemplate();
      template.resourceCountIs('AWS::EC2::EIPAssociation', 1);
    });
  });

  describe('VPC', () => {
    test('creates a VPC with a single public subnet and no NAT gateways', () => {
      const template = makeTemplate();
      // No NAT Gateway
      template.resourceCountIs('AWS::EC2::NatGateway', 0);
      // One Internet Gateway
      template.resourceCountIs('AWS::EC2::InternetGateway', 1);
    });
  });

  describe('Stack outputs', () => {
    test('exports InstanceId, ElasticIp, SshCommand, VsCodeRemoteSshTarget, JetBrainsGatewayTarget', () => {
      const template = makeTemplate();
      const outputs = template.toJSON().Outputs ?? {};
      expect(Object.keys(outputs)).toEqual(
        expect.arrayContaining([
          'InstanceId',
          'ElasticIp',
          'SshCommand',
          'VsCodeRemoteSshTarget',
          'JetBrainsGatewayTarget',
        ]),
      );
    });
  });
});

