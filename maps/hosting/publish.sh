#!/usr/bin/env bash
# Publishes one .pmtiles file to the ride-on-maps R2 bucket through R2's S3 API:
#   maps/hosting/publish.sh <file.pmtiles> [key]
# Refuses a key that already exists, uploads with the AWS CLI's `r2` profile, then checks the stored
# object and compares byte ranges of the public URL with the local file. Profile setup: maps/README.md.
set -euo pipefail

file=${1:?usage: publish.sh <file.pmtiles> [key]}
key=${2:-$(basename "$file")}
bucket=ride-on-maps
endpoint=https://3343118697a4beccae42090c4520cd29.r2.cloudflarestorage.com
public=https://maps.ride-on.cc/$key
type=application/vnd.pmtiles
cache='public, max-age=31536000, immutable'
mib=1048576

# Every call names the profile and endpoint: never fall back to another AWS profile.
r2() { aws --profile r2 --endpoint-url "$endpoint" "$@"; }
fail() { echo "$*" >&2; exit 1; }

[[ -f $file ]] || fail "No such file: $file"
[[ $(head -c 7 "$file") == PMTiles ]] || fail "$file isn't a PMTiles archive"
aws configure list-profiles | grep -qx r2 || fail "No AWS CLI profile named r2: see maps/README.md"
size=$(wc -c < "$file" | tr -d " ")

# Keys are immutable and `aws s3 cp` overwrites silently, so the key must be free.
if out=$(r2 s3api head-object --bucket "$bucket" --key "$key" 2>&1); then
  fail "s3://$bucket/$key already exists: publish under a new key"
elif ! grep -q '(404)' <<<"$out"; then
  fail "Couldn't check s3://$bucket/$key: $out"
fi

echo "Uploading $file ($size bytes) to s3://$bucket/$key"
r2 s3 cp "$file" "s3://$bucket/$key" --content-type "$type" --cache-control "$cache"

stored=$(r2 s3api head-object --bucket "$bucket" --key "$key" \
  --query '[ContentLength, ContentType, CacheControl]' --output text)
[[ $stored == "$size"$'\t'"$type"$'\t'"$cache" ]] || fail "Stored object doesn't match: $stored"

# Compares <length> bytes at <offset> of the public URL with the local file.
same() {
  local offset=$1 length=$2
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' -r "$offset-$((offset + length - 1))" "$public")
  [[ $status == 206 ]] || fail "Range $offset+$length of $public returned $status"
  cmp -s <(curl -sf -r "$offset-$((offset + length - 1))" "$public") \
    <(tail -c +$((offset + 1)) "$file" | head -c "$length") ||
    fail "Range $offset+$length of $public differs from $file"
}

echo "Comparing $public with $file"
same 0 16384
[[ $size -gt $mib ]] && same $((size - mib)) $mib
for i in $(seq 1 24); do
  offset=$((size * i / 25))
  length=$((size - offset < mib ? size - offset : mib))
  same "$offset" "$length"
done

echo "Published $public"
