import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface RedisDemoStackProps extends cdk.StackProps {
  /** 計測ホストが clone するリポジトリ URL */
  repoUrl: string;
  /** clone するブランチ */
  repoBranch: string;
  /** RDS MySQL のエンジンバージョン ("8.4" = major のみ、または "8.4.11" のように固定) */
  mysqlVersion: string;
  /** ElastiCache Valkey のエンジンバージョン */
  valkeyVersion: string;
}

/**
 * 使い捨ての計測環境 (常時展開しない。計測後は cdk destroy する)。
 *
 *   VPC (2 AZ, public + isolated, NAT なし)
 *   ├─ public   : EC2 t4g.small (AL2023 ARM, SSM 管理, インバウンド 0)  ← 計測ホスト
 *   └─ isolated : ElastiCache Valkey cache.t4g.micro ×1, RDS MySQL 8.4 db.t4g.micro (単一 AZ)
 */
export class RedisDemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RedisDemoStackProps) {
    super(scope, id, props);

    // ---- ネットワーク ----
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.42.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // デフォルト SG は何にも付けないので、制限用のカスタムリソース (Lambda) は作らない
      restrictDefaultSecurityGroup: false,
    });

    const benchSg = new ec2.SecurityGroup(this, 'BenchSg', {
      vpc,
      description: 'redis-demo bench host: no inbound (SSM only)',
      allowAllOutbound: true,
    });
    const cacheSg = new ec2.SecurityGroup(this, 'CacheSg', {
      vpc,
      description: 'redis-demo Valkey: 6379 from bench host only',
      allowAllOutbound: false,
    });
    cacheSg.addIngressRule(benchSg, ec2.Port.tcp(6379), 'Valkey from bench host');
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'redis-demo MySQL: 3306 from bench host only',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(benchSg, ec2.Port.tcp(3306), 'MySQL from bench host');

    // ---- RDS MySQL 8.4 (単一 AZ, パスワードは Secrets Manager 自動生成, 削除時スナップショットなし) ----
    const db = new rds.DatabaseInstance(this, 'Mysql', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.of(props.mysqlVersion, '8.4'),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret('demo'),
      databaseName: 'demo',
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(0),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publiclyAccessible: false,
    });
    const secret = db.secret!;

    // ---- ElastiCache Valkey (単一ノード) ----
    // CloudFormation の AWS::ElastiCache::CacheCluster は Engine=valkey を受け付けないため
    // ReplicationGroup を NumCacheClusters=1 (レプリカなし) で使う (docs/SOURCES.md)
    const cacheSubnets = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'redis-demo isolated subnets',
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });
    const valkey = new elasticache.CfnReplicationGroup(this, 'Valkey', {
      replicationGroupDescription: 'redis-demo Valkey single node',
      engine: 'valkey',
      engineVersion: props.valkeyVersion,
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      multiAzEnabled: false,
      cacheSubnetGroupName: cacheSubnets.ref,
      securityGroupIds: [cacheSg.securityGroupId],
      port: 6379,
      transitEncryptionEnabled: false,
      atRestEncryptionEnabled: false,
      snapshotRetentionLimit: 0,
      autoMinorVersionUpgrade: false,
    });
    valkey.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ---- EC2 計測ホスト (public subnet, SSM 管理, インバウンド 0) ----
    const role = new iam.Role(this, 'BenchRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    secret.grantRead(role); // secretsmanager:GetSecretValue (+DescribeSecret) をこのシークレットに限定

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      // AL2023 は Node.js を nodejs22 / nodejs22-npm パッケージで提供する (docs/SOURCES.md)
      'dnf install -y nodejs22 nodejs22-npm git jq',
      'node --version && npm --version',
      // scripts/aws-env.sh が読む接続情報
      'cat > /etc/redis-demo.env <<EOF',
      `REDIS_HOST=${valkey.attrPrimaryEndPointAddress}`,
      `REDIS_PORT=${valkey.attrPrimaryEndPointPort}`,
      `MYSQL_HOST=${db.dbInstanceEndpointAddress}`,
      `MYSQL_PORT=${db.dbInstanceEndpointPort}`,
      `MYSQL_SECRET_ARN=${secret.secretArn}`,
      `AWS_REGION=${this.region}`,
      'EOF',
      'chmod 600 /etc/redis-demo.env',
      `git clone --depth 1 --branch ${props.repoBranch} ${props.repoUrl} /opt/redis-demo`,
      'cd /opt/redis-demo && npm ci --omit=dev',
      'touch /opt/redis-demo/.ready',
    );

    const instance = new ec2.Instance(this, 'Bench', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      securityGroup: benchSg,
      role,
      userData,
      associatePublicIpAddress: true, // NAT なしで dnf / git / npm / SSM エンドポイントに到達するため
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(16, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    // ---- Outputs (scripts/aws-bench.sh が読む) ----
    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: valkey.attrPrimaryEndPointAddress });
    new cdk.CfnOutput(this, 'MysqlEndpoint', { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'SecretArn', { value: secret.secretArn });
  }
}
