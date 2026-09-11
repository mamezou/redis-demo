#!/usr/bin/env bash
# EC2 計測ホスト上で `source scripts/aws-env.sh` して接続用の環境変数を組み立てる。
#   入力 (優先順): 既に export 済みの環境変数 > /etc/redis-demo.env (CDK の user-data が書く)
#   REDIS_HOST / REDIS_PORT / MYSQL_HOST / MYSQL_PORT / MYSQL_SECRET_ARN / AWS_REGION
#   MySQL の認証情報は Secrets Manager (RDS が自動生成したシークレット) から取得する。
# 必要コマンド: aws (AL2023 に同梱), jq (user-data で dnf install)

_env_file=/etc/redis-demo.env
if [ -f "$_env_file" ]; then
  while IFS='=' read -r _k _v; do
    case "$_k" in ''|'#'*) continue ;; esac
    if [ -z "${!_k:-}" ]; then export "$_k=$_v"; fi
  done < "$_env_file"
fi

: "${AWS_REGION:=ap-northeast-1}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"

if [ -z "${MYSQL_SECRET_ARN:-}" ]; then
  echo "MYSQL_SECRET_ARN が未設定です ($_env_file も無い)" >&2
  return 1 2>/dev/null || exit 1
fi

_secret=$(aws secretsmanager get-secret-value --secret-id "$MYSQL_SECRET_ARN" --region "$AWS_REGION" \
  --query SecretString --output text)
export MYSQL_USER="$(jq -r '.username' <<<"$_secret")"
export MYSQL_PASSWORD="$(jq -r '.password' <<<"$_secret")"
export MYSQL_DATABASE="$(jq -r '.dbname // "demo"' <<<"$_secret")"
export MYSQL_HOST="${MYSQL_HOST:-$(jq -r '.host' <<<"$_secret")}"
export MYSQL_PORT="${MYSQL_PORT:-$(jq -r '.port // 3306' <<<"$_secret")}"
export REDIS_HOST="${REDIS_HOST:?REDIS_HOST が未設定です}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export REDIS_TLS="${REDIS_TLS:-0}"
export MYSQL_SSL="${MYSQL_SSL:-}"
unset _secret _env_file _k _v

echo "[aws-env] REDIS=$REDIS_HOST:$REDIS_PORT MYSQL=$MYSQL_HOST:$MYSQL_PORT/$MYSQL_DATABASE user=$MYSQL_USER" >&2
