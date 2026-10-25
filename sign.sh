#!/bin/sh
# Sign VaughnLiveScript.js into VaughnLiveConfig.json.
# Grayjay's developer server runs the plugin with an empty signature.
# Public distribution needs your own key. Do not commit the private key.
#
#   export SIGNING_PRIVATE_KEY="$(base64 -w 0 < your-private-key.pem)"
#   sh sign.sh VaughnLiveScript.js VaughnLiveConfig.json

JS_FILE_PATH=${1:-VaughnLiveScript.js}
CONFIG_FILE_PATH=${2:-VaughnLiveConfig.json}

if [ -z "$SIGNING_PRIVATE_KEY" ]; then
  echo "SIGNING_PRIVATE_KEY is not set. Export a base64 PEM private key first."
  exit 1
fi

echo "$SIGNING_PRIVATE_KEY" | base64 -d > tmp_private_key.pem

if ! openssl rsa -check -noout -in tmp_private_key.pem > /dev/null 2>&1; then
  echo "Invalid private key."
  rm -f tmp_private_key.pem
  exit 1
fi

SIGNATURE=$(openssl dgst -sha512 -sign tmp_private_key.pem "$JS_FILE_PATH" | base64 -w 0)
PUBLIC_KEY=$(openssl rsa -pubout -outform DER -in tmp_private_key.pem 2>/dev/null | openssl pkey -pubin -inform DER -outform PEM | tail -n +2 | head -n -1 | tr -d '\n')

rm -f tmp_private_key.pem

echo "PUBLIC_KEY: $PUBLIC_KEY"
jq --arg signature "$SIGNATURE" --arg publicKey "$PUBLIC_KEY" \
  '. + {scriptSignature: $signature, scriptPublicKey: $publicKey}' \
  "$CONFIG_FILE_PATH" > temp_config.json && mv temp_config.json "$CONFIG_FILE_PATH"
