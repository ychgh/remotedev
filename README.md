# remotedev

A cloud-based developer workstation powered by **AWS CDK** (TypeScript).

The idea: source code, tools, containers, and runtimes live on an EC2 instance in the cloud while you use your local editor as the UI.

Compatible with:
- **VS Code Remote – SSH** and **VS Code Remote Tunnels**
- **JetBrains Gateway**

## Infrastructure overview

| Resource | Details |
|---|---|
| EC2 instance | `m5.2xlarge` by default — **8 vCPUs, 32 GiB RAM** (configurable) |
| OS | Ubuntu 22.04 LTS (latest AMI via Canonical SSM parameter) |
| Storage | 100 GiB gp3 root volume, encrypted |
| Network | Dedicated VPC, public subnet, Elastic IP (stable address) |
| Security | SSH (port 22) + AWS Systems Manager Session Manager |
| IAM | `AmazonSSMManagedInstanceCore` managed policy |
| Pre-installed tools | `git`, `curl`, `wget`, `build-essential`, Docker, Python 3, Node.js (via nvm) |

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18 and npm
- [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html): `npm install -g aws-cdk`
- AWS CLI configured with credentials that have EC2/VPC/IAM permissions
- An EC2 Key Pair in the target region (for SSH access — optional if you use Session Manager)

## Quick start

```bash
cd cdk
npm install
npm run build
```

**Bootstrap** (once per account/region):

```bash
npx cdk bootstrap
```

**Deploy:**

```bash
# Minimal – no SSH key, use Session Manager only
npx cdk deploy

# With SSH key and restricted source IP (recommended)
npx cdk deploy \
  -c keyName=my-key-pair \
  -c allowedSshCidr=203.0.113.10/32
```

After deployment the CLI prints the stack outputs:

```
Outputs:
RemoteDevStack.ElasticIp             = 1.2.3.4
RemoteDevStack.InstanceId            = i-0abcdef1234567890
RemoteDevStack.SshCommand            = ssh -i my-key-pair.pem ubuntu@1.2.3.4
RemoteDevStack.VsCodeRemoteSshTarget = ubuntu@1.2.3.4
RemoteDevStack.JetBrainsGatewayTarget= ubuntu@1.2.3.4
```

## Connecting with VS Code Remote SSH

1. Add an entry to `~/.ssh/config`:
   ```
   Host remotedev
       HostName <ElasticIp>
       User ubuntu
       IdentityFile ~/.ssh/my-key-pair.pem
   ```
2. In VS Code open the Command Palette → **Remote-SSH: Connect to Host…** → choose `remotedev`.

## Connecting with JetBrains Gateway

1. Open JetBrains Gateway → **Connect via SSH**.
2. Host: `<ElasticIp>`, User: `ubuntu`, Authentication: your `.pem` key.

## VS Code Remote Tunnels (no open port needed)

SSH into the instance once and run:

```bash
curl -Lk 'https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64' --output /tmp/vscode_cli.tar.gz
tar -xf /tmp/vscode_cli.tar.gz -C /usr/local/bin
code tunnel --accept-server-license-terms
```

Then follow the GitHub sign-in link that appears.

## CDK context parameters

| Key | Default | Description |
|---|---|---|
| `keyName` | _(none)_ | Name of an existing EC2 Key Pair. Omit to use Session Manager only. |
| `allowedSshCidr` | `0.0.0.0/0` | IPv4 CIDR allowed to reach port 22. Restrict to your IP. |
| `instanceType` | `m5.2xlarge` | Any EC2 instance type with ≥8 vCPUs and ≥32 GiB RAM. |

## Teardown

```bash
npx cdk destroy
```
