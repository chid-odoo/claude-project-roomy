#!/usr/bin/env bash
# Create HTTPS certificates for testing Roomy on your phone over the local
# network. Phones only install web apps (and run service workers) on HTTPS
# sites they trust, so this makes:
#
#   .cert/roomy-local-ca.crt  a small certificate authority you install on
#                             the phone once ("trust this CA")
#   .cert/cert.pem, key.pem   a certificate for localhost and this computer's
#                             current network addresses, signed by that CA
#
# Re-run it when the computer's network address changes; the CA is kept, so
# the phone does not need to trust a new one. Everything stays in .cert/,
# which git ignores. Keep ca-key.pem private: anyone with it can make
# certificates your phone would trust.
set -euo pipefail

dir="${CERT_DIR:-$(dirname "$0")/../.cert}"
mkdir -p "$dir"
cd "$dir"

if [[ ! -f ca-key.pem ]]; then
    openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 825 \
        -keyout ca-key.pem -out roomy-local-ca.crt \
        -subj "/CN=Roomy local development CA" \
        -addext "basicConstraints=critical,CA:TRUE" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
    chmod 600 ca-key.pem
    echo "Created a new local CA: $(pwd)/roomy-local-ca.crt"
fi

names="DNS:localhost,IP:127.0.0.1"
for ip in ${ROOMY_IPS:-$(hostname -I 2>/dev/null || true)}; do
    [[ "$ip" == *:* ]] && continue  # skip IPv6
    names="$names,IP:$ip"
done

openssl req -new -nodes -newkey rsa:2048 -keyout key.pem -out cert.csr \
    -subj "/CN=Roomy local server" 2>/dev/null
# iOS rejects server certificates valid for more than 825 days.
openssl x509 -req -in cert.csr -CA roomy-local-ca.crt -CAkey ca-key.pem -CAcreateserial \
    -out cert.pem -days 825 -sha256 \
    -extfile <(printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$names") 2>/dev/null
rm -f cert.csr
chmod 600 key.pem

echo "Certificate for: ${names//,/ }"
echo "Next: install roomy-local-ca.crt on your phone (see README), then run: npm run phone"
