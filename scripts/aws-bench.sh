#!/usr/bin/env bash
# ローカルから SSM Run Command で EC2 計測ホスト上の `npm run seed && npm run bench` を実行し、結果を表示する。
#   npm run aws:bench                  # 既定: --users 100000
#   USERS=20000 npm run aws:bench
# 環境変数: AWS_PROFILE (既定 demo01), STACK_NAME (既定 RedisDemoStack), AWS_REGION (既定 ap-northeast-1),
#           USERS (seed 件数), BENCH_ARGS (npm run bench に渡す追加引数)
set -euo pipefail

PROFILE="${AWS_PROFILE:-demo01}"
STACK="${STACK_NAME:-RedisDemoStack}"
REGION="${AWS_REGION:-ap-northeast-1}"
USERS="${USERS:-100000}"
BENCH_ARGS="${BENCH_ARGS:-}"
AWS=(aws --profile "$PROFILE" --region "$REGION")

output() {
  "${AWS[@]}" cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "[aws-bench] account: $("${AWS[@]}" sts get-caller-identity --query Account --output text) / stack: $STACK" >&2
INSTANCE_ID=$(output InstanceId)
REDIS_HOST=$(output RedisEndpoint)
MYSQL_HOST=$(output MysqlEndpoint)
SECRET_ARN=$(output SecretArn)
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "[aws-bench] Outputs が取得できません。先に npm run aws:deploy を実行してください" >&2
  exit 1
fi
echo "[aws-bench] instance=$INSTANCE_ID redis=$REDIS_HOST mysql=$MYSQL_HOST" >&2

# SSM エージェントが Online になるまで待つ (起動直後は数分かかる)
for _ in $(seq 1 60); do
  status=$("${AWS[@]}" ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$status" = "Online" ] && break
  echo "[aws-bench] SSM 登録待ち ($status)..." >&2
  sleep 10
done
[ "$status" = "Online" ] || { echo "[aws-bench] SSM が Online になりません" >&2; exit 1; }

# EC2 側で実行するスクリプト (user-data 完了 → 環境変数組み立て → seed → bench)
REMOTE=$(cat <<REMOTE_EOF
set -euo pipefail
for _ in \$(seq 1 120); do [ -f /opt/redis-demo/.ready ] && break; sleep 5; done
[ -f /opt/redis-demo/.ready ] || { echo 'user-data (Node/リポジトリ準備) が完了していません' >&2; exit 1; }
cd /opt/redis-demo
export REDIS_HOST='$REDIS_HOST' MYSQL_HOST='$MYSQL_HOST' MYSQL_SECRET_ARN='$SECRET_ARN' AWS_REGION='$REGION'
source scripts/aws-env.sh
npm run seed -- --users $USERS
npm run bench -- $BENCH_ARGS
REMOTE_EOF
)
# 複数行スクリプトを引用符の問題なく渡すため base64 で包む (EC2 側の sh が展開して bash で実行)
REMOTE_B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
PARAMS=$(jq -n --arg c "echo $REMOTE_B64 | base64 -d | bash" '{commands: [$c], executionTimeout: ["3600"]}')

COMMAND_ID=$("${AWS[@]}" ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "redis-demo seed+bench (users=$USERS)" \
  --timeout-seconds 600 \
  --parameters "$PARAMS" \
  --query 'Command.CommandId' --output text)
echo "[aws-bench] command=$COMMAND_ID 実行中 (seed $USERS 件 + bench)..." >&2

while :; do
  sleep 10
  STATUS=$("${AWS[@]}" ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending|InProgress|Delayed) echo "[aws-bench] $STATUS..." >&2 ;;
    *) break ;;
  esac
done

"${AWS[@]}" ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' --output text >&2
"${AWS[@]}" ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text
if [ "$STATUS" != "Success" ]; then
  echo "[aws-bench] 失敗: $STATUS" >&2
  exit 1
fi
