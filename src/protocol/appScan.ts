/**
 * Quantumize My App: a pattern-based static scan for cryptography a large
 * quantum computer would break or weaken. Pure and deterministic, so the
 * browser (local folders, pasted code) and the server (public GitHub
 * repositories) produce identical reports from identical input.
 *
 * It matches source text against known APIs and identifiers. It does not
 * execute or compile code, resolve imports, or follow data flow, so every
 * finding is a lead to review, not a verdict.
 */

export const APP_SCAN_VERSION = '1.0.0'

export const SCAN_LIMITS = {
  /** Larger text files are counted but not read. */
  maxFileBytes: 400 * 1024,
  maxFilesScanned: 6000,
  /** Lines longer than this are only partly read; minified code is skipped. */
  maxLineChars: 2000,
  locationsPerSurface: 40,
  occurrencesPerFile: 20,
} as const

/* ---------- vocabulary ---------- */

/** BROKEN: Shor's algorithm. WEAKENED: Grover's algorithm. CLASSICAL: weak today, unrelated to quantum. REVIEW: depends on how it is used. PQ: post-quantum. */
export type ScanRisk = 'BROKEN' | 'WEAKENED' | 'REVIEW' | 'CLASSICAL' | 'PQ'

export const RISK_LABEL: Record<ScanRisk, string> = {
  BROKEN: 'QUANTUM-VULNERABLE',
  WEAKENED: 'QUANTUM-WEAKENED',
  REVIEW: 'REVIEW',
  CLASSICAL: 'WEAK TODAY',
  PQ: 'POST-QUANTUM',
}

export const RISK_MEANING: Record<ScanRisk, string> = {
  BROKEN: 'A large quantum computer running Shor’s algorithm breaks this outright.',
  WEAKENED: 'Grover’s algorithm reduces its security margin. A larger key restores it.',
  REVIEW: 'A general-purpose library. Whether it is exposed depends on which algorithms you use.',
  CLASSICAL: 'Already weak against ordinary computers. Unrelated to quantum, but worth fixing.',
  PQ: 'A post-quantum primitive is referenced.',
}

export type ScanSurface = 'key-exchange' | 'encryption' | 'transport' | 'key-material' | 'token' | 'signature' | 'chain' | 'dependency' | 'symmetric' | 'hash' | 'pq'

export const SURFACE_LABEL: Record<ScanSurface, string> = {
  'key-exchange': 'Key exchange',
  encryption: 'Public-key encryption',
  transport: 'Transport',
  'key-material': 'Key material in the repository',
  token: 'Signed tokens',
  signature: 'Signatures',
  chain: 'Blockchain keys',
  dependency: 'Dependencies',
  symmetric: 'Symmetric encryption',
  hash: 'Hashing',
  pq: 'Post-quantum',
}

/** Fix-first order. Harvest-now-decrypt-later exposures lead: recorded data is at risk before a quantum computer exists. */
const SURFACE_ORDER: ScanSurface[] = ['key-material', 'key-exchange', 'encryption', 'transport', 'token', 'signature', 'chain', 'dependency', 'symmetric', 'hash', 'pq']
const RISK_ORDER: ScanRisk[] = ['BROKEN', 'REVIEW', 'WEAKENED', 'CLASSICAL', 'PQ']

export interface ScanRule {
  id: string
  title: string
  surface: ScanSurface
  risk: ScanRisk
  /** Recorded traffic or data could be decrypted later. */
  harvestNow: boolean
  /** Whether the application can make the change on its own. */
  inApp: boolean
  pattern: RegExp
  why: string
  fix: string
  standard?: string
  /** Show only the matched text, never the surrounding line. */
  redact?: boolean
  /** Also applies to key and certificate files. */
  keyFiles?: boolean
  /** Not reported on a line already matched by one of these more specific rules. */
  unless?: string[]
}

const SHOR_SECRET = 'A quantum computer running Shor’s algorithm recovers the private key, and with it the shared secret. Traffic or data recorded today can be decrypted later.'
const SHOR_FORGE = 'A quantum computer running Shor’s algorithm recovers the private key from the public key, so signatures can be forged. Past signatures matter only where keys are long-lived.'
const KEM_FIX = 'Hybrid key establishment: X25519 together with ML-KEM-768, so the session stays safe if either holds.'
const SIG_FIX = 'ML-DSA-65 for general signing; SLH-DSA for long-lived roots of trust. Run hybrid (classical and post-quantum) during migration.'

export const SCAN_RULES: ScanRule[] = [
  {
    id: 'private-key',
    title: 'Private key committed',
    surface: 'key-material',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
    why: 'A private key is stored in the repository. Anyone with read access has it today; no quantum computer is needed.',
    fix: 'Remove it from the repository and its history, rotate it, and load keys from a secret manager.',
    redact: true,
    keyFiles: true,
  },
  {
    id: 'ecdh',
    title: 'Elliptic-curve key exchange (ECDH, X25519)',
    surface: 'key-exchange',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern:
      /\bcreateECDH\s*\(|['"]ECDH(?:-ES(?:\+A\d{3}KW)?)?['"]|\bec\.ECDH\s*\(|\becdh\.(?:P256|P384|P521|X25519)\s*\(|KeyAgreement\.getInstance\(\s*"(?:ECDH|XDH|X25519)"|\b[xX]25519(?!MLKEM|Kyber|_?mlkem)|\b[xX]448\b|\bcrypto_box(?:_\w+)?\b|\bcrypto_kx_\w+|\bcrypto_scalarmult\w*|\bnacl\.box\b|\bSealedBox\b|"crypto\/ecdh"|\beccrypto\b|\becies\b|\bECIES\b/,
    why: SHOR_SECRET,
    fix: KEM_FIX,
    standard: 'FIPS 203 (ML-KEM)',
  },
  {
    id: 'dh',
    title: 'Diffie-Hellman key exchange',
    surface: 'key-exchange',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern: /\bcreateDiffieHellman(?:Group)?\s*\(|\bgetDiffieHellman\s*\(|\bdh\.generate_parameters\s*\(|\bDHParameterSpec\b|KeyPairGenerator\.getInstance\(\s*"(?:DH|DiffieHellman)"|\bopenssl\s+dhparam\b|\bssl_dhparam\b/,
    why: SHOR_SECRET,
    fix: KEM_FIX,
    standard: 'FIPS 203 (ML-KEM)',
  },
  {
    id: 'rsa-encryption',
    title: 'RSA encryption',
    surface: 'encryption',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern: /['"]RSA-OAEP(?:-\d{3})?['"]|\bpublicEncrypt\s*\(|\bprivateDecrypt\s*\(|\bPKCS1_OAEP\b|\bpadding\.OAEP\s*\(|\brsa\.(?:EncryptOAEP|DecryptOAEP|EncryptPKCS1v15|DecryptPKCS1v15)\b|Cipher\.getInstance\(\s*"RSA|\bRSAES[-_]OAEP\b|\bRSA_PKCS1_OAEP_PADDING\b/,
    why: SHOR_SECRET,
    fix: 'Wrap data keys with ML-KEM-768 instead of RSA, in a hybrid with your current scheme during migration. Re-wrap stored keys that must stay secret for years.',
    standard: 'FIPS 203 (ML-KEM)',
  },
  {
    id: 'pgp',
    title: 'OpenPGP encryption',
    surface: 'encryption',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern: /-----BEGIN PGP PUBLIC KEY BLOCK-----|-----BEGIN PGP MESSAGE-----|\bopenpgp\.(?:encrypt|decrypt|generateKey|readKey)\b|\bgpg\s+--(?:gen-key|full-generate-key|encrypt)\b/,
    why: SHOR_SECRET,
    fix: 'Track post-quantum OpenPGP (ML-KEM and ML-DSA composite keys, an IETF draft). Until then, avoid using PGP for data that must stay secret for years.',
    standard: 'IETF draft: post-quantum OpenPGP',
    keyFiles: true,
  },
  {
    id: 'tls',
    title: 'TLS configured in code',
    surface: 'transport',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern:
      /\bssl_ecdh_curve\b|\bssl_ciphers\b|\bECDHE-(?:RSA|ECDSA)-[A-Z0-9-]+|\bTLS_ECDHE_\w+|\btls\.(?:createServer|connect|createSecureContext)\s*\(|\bhttps\.createServer\s*\(|\bssl\.(?:create_default_context|SSLContext|wrap_socket)\s*\(|\btls\.Config\s*\{|\bListenAndServeTLS\s*\(|\bCurvePreferences\b|\bSSLContext\.getInstance\b|\becdhCurve\b/,
    why: 'TLS key exchange today is ECDHE or RSA. Recorded sessions can be decrypted later by a quantum computer, even though they are safe now.',
    fix: 'TLS 1.3 with the hybrid X25519MLKEM768 key exchange group. OpenSSL 3.5+, BoringSSL, Go 1.24+ and rustls support it. If a CDN or load balancer terminates TLS, enable it there.',
    standard: 'FIPS 203 (ML-KEM), IETF hybrid TLS draft',
  },
  {
    id: 'ssh',
    title: 'SSH keys and algorithms',
    surface: 'transport',
    risk: 'BROKEN',
    harvestNow: true,
    inApp: true,
    pattern: /\bssh-(?:rsa|dss|ed25519)\b|\becdsa-sha2-nistp\d{3}\b|\bparamiko\.(?:RSAKey|ECDSAKey|Ed25519Key)\b|\bHostKeyAlgorithms\b|\bKexAlgorithms\b/,
    why: 'Classical SSH key exchange can be decrypted later from a recording. Host and user keys are classical signatures that a quantum computer could forge.',
    fix: 'OpenSSH 9.0+ negotiates the hybrid sntrup761x25519 key exchange by default, and 9.9 adds mlkem768x25519. Keep both sides current. Host and user keys stay classical for now.',
    standard: 'OpenSSH hybrid key exchange',
  },
  {
    id: 'jwt',
    title: 'Tokens signed with RSA, ECDSA or EdDSA',
    surface: 'token',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: true,
    pattern: /['"](?:RS|PS|ES)(?:256|384|512)['"]|['"]ES256K['"]|['"]EdDSA['"]/,
    why: 'JWTs and other JOSE tokens signed with RS*, PS*, ES* or EdDSA can be forged once the signing key is recovered from its public key.',
    fix: 'Between services that share a secret, HMAC (HS256) is not affected. For public verification, plan for ML-DSA in JOSE, which is still being standardized, and keep tokens short-lived.',
    standard: 'FIPS 204 (ML-DSA), IETF JOSE draft',
  },
  {
    id: 'rsa-signature',
    title: 'RSA keys and signatures',
    surface: 'signature',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: true,
    pattern:
      /\bgenerateKeyPair(?:Sync)?\(\s*['"]rsa(?:-pss)?['"]|\bgenerate_private_key\(\s*public_exponent|\bRSA\.(?:generate|import_key|importKey|construct)\s*\(|\brsa\.(?:GenerateKey|SignPKCS1v15|SignPSS|VerifyPKCS1v15|VerifyPSS)\b|KeyPairGenerator\.getInstance\(\s*"RSA"|\bRSA\.Create\s*\(|\bRSACryptoServiceProvider\b|\bR(?:sa|SA)(?:Private|Public)Key\b|\bnew\s+NodeRSA\b|['"]RSASSA-PKCS1-v1_5['"]|['"]RSA-PSS['"]|\bSHA\d{3}withRSA\b|\bopenssl\s+genrsa\b|"crypto\/rsa"/,
    why: `${SHOR_FORGE} If the same keys also encrypt or wrap keys, treat them as a harvest-now risk.`,
    fix: SIG_FIX,
    standard: 'FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA)',
  },
  {
    id: 'ecdsa',
    title: 'ECDSA and NIST curves',
    surface: 'signature',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: true,
    pattern:
      /['"]ECDSA['"]|\becdsa\.(?:Sign|SignASN1|Verify|VerifyASN1|GenerateKey)\b|\bec\.generate_private_key\s*\(|\bec\.ECDSA\s*\(|\bSHA\d{3}withECDSA\b|KeyPairGenerator\.getInstance\(\s*"EC"|\bgenerateKeyPair(?:Sync)?\(\s*['"]ec['"]|\bECDsa(?:Cng)?\.Create\b|\bsecp256r1\b|\bprime256v1\b|\bsecp384r1\b|\bsecp521r1\b|['"]P-(?:256|384|521)['"]|"crypto\/ecdsa"|"crypto\/elliptic"/,
    why: SHOR_FORGE,
    fix: SIG_FIX,
    standard: 'FIPS 204 (ML-DSA)',
    unless: ['ecdh', 'tls', 'ssh'],
  },
  {
    id: 'eddsa',
    title: 'Ed25519 signatures',
    surface: 'signature',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: true,
    pattern: /\b[eE]d25519\b|\bED25519\b|\b[eE]d448\b|\bnacl\.sign\b|\bnacl\.signing\b|\bcrypto_sign_ed25519\w*|\bed25519_dalek\b|"crypto\/ed25519"|\bgenerateKeyPair(?:Sync)?\(\s*['"]ed(?:25519|448)['"]/,
    why: SHOR_FORGE,
    fix: SIG_FIX,
    standard: 'FIPS 204 (ML-DSA)',
    unless: ['ssh'],
  },
  {
    id: 'dsa',
    title: 'DSA signatures',
    surface: 'signature',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: true,
    pattern: /['"]DSA['"]|\bDSA(?:PrivateKey|PublicKey|Signer|_\w+)\b|KeyPairGenerator\.getInstance\(\s*"DSA"|\bdsa\.generate_private_key\b|\bDSA\.(?:generate|construct)\s*\(|"crypto\/dsa"|\bssh-dss\b/,
    why: `${SHOR_FORGE} DSA is also deprecated for new signatures by NIST today.`,
    fix: SIG_FIX,
    standard: 'FIPS 204 (ML-DSA)',
    unless: ['ssh'],
  },
  {
    id: 'certificate',
    title: 'X.509 certificates',
    surface: 'signature',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: false,
    pattern: /-----BEGIN CERTIFICATE-----|\bopenssl\s+req\b.*-x509|\bx509\.CreateCertificate\b|\bCertificateBuilder\s*\(/,
    why: 'Certificates are signed with RSA or ECDSA. A forged certificate lets an attacker impersonate a server.',
    fix: 'Certificates come from your certificate authority. Post-quantum certificates depend on CAs and browsers adopting ML-DSA; keep certificate lifetimes short and automate renewal so you can switch quickly.',
    standard: 'FIPS 204 (ML-DSA) certificates, IETF LAMPS drafts',
    keyFiles: true,
  },
  {
    id: 'wallet-signatures',
    title: 'Wallet signatures',
    surface: 'chain',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: false,
    pattern: /\bsignMessage\s*\(|\bsignTransaction\s*\(|\bsignAllTransactions\s*\(|\bsignTypedData\w*\s*\(|\bpersonal_sign\b|\beth_sign\b|\becrecover\s*\(|\bverifyMessage\s*\(/,
    why: 'Wallet signatures use the chain’s scheme (Ed25519 on Solana, secp256k1 on Ethereum and Bitcoin). A quantum computer could forge them for any account whose public key is known.',
    fix: 'The chain sets this scheme, so an app cannot upgrade it alone. Avoid relying on wallet signatures for long-lived authorization, and follow the chain’s post-quantum migration.',
    standard: 'Depends on the chain',
  },
  {
    id: 'chain-keys',
    title: 'Blockchain key pairs',
    surface: 'chain',
    risk: 'BROKEN',
    harvestNow: false,
    inApp: false,
    pattern: /\bKeypair\.(?:generate|fromSecretKey|fromSeed)\s*\(|\bsecp256k1\b|\bk256::|\bethers\.Wallet\b|\bWallet\.(?:createRandom|fromPhrase|fromMnemonic)\s*\(|\bprivateKeyToAccount\s*\(|\bmnemonicToAccount\s*\(|\bECPair\b|\bsolana_sdk::signature\b|\bsolders\.keypair\b/,
    why: 'These keys use the chain’s signature scheme. A quantum computer could recover them from public keys that have appeared on-chain.',
    fix: 'Set by the chain. Keep high-value keys in addresses whose public key has not been revealed where the chain allows it, and follow the chain’s post-quantum migration.',
    standard: 'Depends on the chain',
  },
  {
    id: 'aes-128',
    title: 'AES-128',
    surface: 'symmetric',
    risk: 'WEAKENED',
    harvestNow: false,
    inApp: true,
    pattern: /(?<![A-Za-z0-9])aes[-_]?128(?!\d)|\bA128(?:GCM|KW|GCMKW|CBC-HS256)\b/i,
    why: 'Grover’s algorithm roughly halves the effective strength of a symmetric key. AES-128 is not broken, but its margin shrinks.',
    fix: 'Use AES-256 for data that must stay confidential for decades.',
    standard: 'NIST SP 800-131A, CNSA 2.0',
  },
  {
    id: 'legacy-hash',
    title: 'MD5 or SHA-1',
    surface: 'hash',
    risk: 'CLASSICAL',
    harvestNow: false,
    inApp: true,
    pattern: /\bcreateHash\(\s*['"](?:md5|sha1)['"]|\bhashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\(\s*"(?:MD5|SHA-?1)"|\b(?:md5|sha1)\.(?:New|Sum)\s*\(|\bDigest::(?:MD5|SHA1)\b|"crypto\/(?:md5|sha1)"|['"]SHA-1['"]/,
    why: 'Collisions can be found with ordinary computers today. This is not a quantum issue.',
    fix: 'SHA-256 or SHA-3 for integrity and signatures. Quantum computers do not materially weaken them.',
    standard: 'FIPS 180-4, FIPS 202',
  },
  {
    id: 'legacy-cipher',
    title: 'Legacy ciphers (3DES, RC4, Blowfish)',
    surface: 'symmetric',
    risk: 'CLASSICAL',
    harvestNow: false,
    inApp: true,
    pattern: /\b(?:des-ede3(?:-cbc)?|DESede|TripleDES|3DES|rc4|RC4|arcfour|Blowfish|bf-cbc)\b/,
    why: 'Weak against ordinary computers today. This is not a quantum issue.',
    fix: 'AES-256-GCM or ChaCha20-Poly1305.',
    standard: 'NIST SP 800-131A',
  },
  {
    id: 'pq',
    title: 'Post-quantum primitives',
    surface: 'pq',
    risk: 'PQ',
    harvestNow: false,
    inApp: true,
    pattern: /\b(?:ml[-_]?kem|mlkem|kyber|ml[-_]?dsa|mldsa|dilithium|slh[-_]?dsa|sphincs|fn-dsa|liboqs|sntrup761|xmss)\w*|\bX25519MLKEM768\b|"crypto\/mlkem"|@noble\/post-quantum|\bpqcrypto\b|\boqs\.(?:KeyEncapsulation|Signature)\b/i,
    why: 'Post-quantum algorithms are referenced here.',
    fix: 'Check each one comes from a maintained implementation, runs in a hybrid with a classical scheme during migration, and uses a standardized parameter set (ML-KEM-768, ML-DSA-65).',
    standard: 'FIPS 203, FIPS 204, FIPS 205',
  },
]

export const RULE_BY_ID: Record<string, ScanRule> = Object.fromEntries(SCAN_RULES.map((rule) => [rule.id, rule]))
const PQ_RULE = RULE_BY_ID.pq
const KEY_RULES = SCAN_RULES.filter((rule) => rule.keyFiles)
const MANIFEST_RULES = SCAN_RULES.filter((rule) => rule.id === 'private-key')

/* ---------- dependency catalog ---------- */

export type Ecosystem = 'npm' | 'pypi' | 'go' | 'cargo' | 'gem' | 'maven' | 'composer'

interface Library {
  name: string
  ecosystem: Ecosystem
  risk: ScanRisk
  provides: string
}

const lib = (ecosystem: Ecosystem, risk: ScanRisk, provides: string, ...names: string[]): Library[] => names.map((name) => ({ name, ecosystem, risk, provides }))

export const LIBRARIES: Library[] = [
  ...lib('npm', 'BROKEN', 'Elliptic-curve signatures or key exchange', 'elliptic', 'tweetnacl', 'tweetnacl-util', '@noble/curves', '@noble/ed25519', '@noble/secp256k1', 'secp256k1', 'ed25519', '@stablelib/ed25519', '@stablelib/x25519', 'eccrypto', 'eciesjs'),
  ...lib('npm', 'BROKEN', 'RSA', 'node-rsa', 'jsencrypt', 'jsrsasign'),
  ...lib('npm', 'BROKEN', 'Blockchain keys and signatures', 'ethers', 'viem', 'web3', '@solana/web3.js', '@solana/kit', 'bitcoinjs-lib', '@coral-xyz/anchor', 'ecpair'),
  ...lib('npm', 'REVIEW', 'Signed tokens', 'jsonwebtoken', 'jose', 'node-jose', 'jwks-rsa', 'passport-jwt', 'express-jwt'),
  ...lib('npm', 'REVIEW', 'General cryptography', 'node-forge', 'openpgp', 'libsodium-wrappers', 'sodium-native', 'ssh2', '@peculiar/x509', '@peculiar/webcrypto', 'crypto-js'),
  ...lib('npm', 'PQ', 'Post-quantum algorithms', '@noble/post-quantum', 'crystals-kyber', 'pqc-kyber', 'mlkem', '@openpgp/pqc', 'liboqs-node', '@dashlane/pqc-kem-kyber512-node'),
  ...lib('pypi', 'REVIEW', 'General cryptography', 'cryptography', 'pycryptodome', 'pycryptodomex', 'pyopenssl', 'pynacl', 'paramiko', 'm2crypto'),
  ...lib('pypi', 'BROKEN', 'RSA or elliptic-curve signatures', 'rsa', 'ecdsa', 'ed25519', 'coincurve', 'eth-keys'),
  ...lib('pypi', 'REVIEW', 'Signed tokens', 'pyjwt', 'python-jose', 'authlib', 'jwcrypto'),
  ...lib('pypi', 'BROKEN', 'Blockchain keys and signatures', 'web3', 'eth-account', 'solana', 'solders', 'bitcoinlib', 'anchorpy'),
  ...lib('pypi', 'PQ', 'Post-quantum algorithms', 'liboqs-python', 'oqs', 'pqcrypto', 'kyber-py', 'dilithium-py', 'quantcrypt'),
  ...lib('go', 'REVIEW', 'General cryptography', 'golang.org/x/crypto'),
  ...lib('go', 'REVIEW', 'Signed tokens', 'github.com/golang-jwt/jwt', 'github.com/lestrrat-go/jwx', 'github.com/go-jose/go-jose'),
  ...lib('go', 'BROKEN', 'Blockchain keys and signatures', 'github.com/ethereum/go-ethereum', 'github.com/gagliardetto/solana-go', 'github.com/btcsuite/btcd'),
  ...lib('go', 'PQ', 'Post-quantum algorithms', 'github.com/cloudflare/circl', 'github.com/open-quantum-safe/liboqs-go'),
  ...lib('cargo', 'BROKEN', 'RSA or elliptic-curve cryptography', 'rsa', 'ed25519-dalek', 'x25519-dalek', 'curve25519-dalek', 'k256', 'p256', 'p384', 'secp256k1', 'ecdsa'),
  ...lib('cargo', 'REVIEW', 'General cryptography', 'ring', 'openssl', 'aws-lc-rs', 'sodiumoxide', 'jsonwebtoken', 'josekit'),
  ...lib('cargo', 'BROKEN', 'Blockchain keys and signatures', 'solana-sdk', 'anchor-lang', 'ethers', 'alloy', 'bitcoin'),
  ...lib('cargo', 'PQ', 'Post-quantum algorithms', 'pqcrypto', 'oqs', 'ml-kem', 'ml-dsa', 'slh-dsa', 'fips203', 'fips204', 'fips205', 'pqc_kyber', 'libcrux-ml-kem'),
  ...lib('gem', 'REVIEW', 'General cryptography', 'rbnacl', 'openssl', 'net-ssh'),
  ...lib('gem', 'REVIEW', 'Signed tokens', 'jwt', 'json-jwt'),
  ...lib('gem', 'BROKEN', 'Elliptic-curve signatures', 'ed25519', 'ecdsa', 'eth'),
  ...lib('maven', 'REVIEW', 'General cryptography', 'bcprov-jdk18on', 'bcprov-jdk15on', 'bcpkix-jdk18on', 'tink'),
  ...lib('maven', 'REVIEW', 'Signed tokens', 'jjwt', 'jjwt-api', 'nimbus-jose-jwt', 'java-jwt'),
  ...lib('maven', 'BROKEN', 'Blockchain keys and signatures', 'web3j'),
  ...lib('composer', 'REVIEW', 'General cryptography', 'phpseclib/phpseclib', 'paragonie/sodium_compat', 'defuse/php-encryption'),
  ...lib('composer', 'REVIEW', 'Signed tokens', 'firebase/php-jwt', 'lcobucci/jwt', 'web-token/jwt-framework'),
]

const LIBRARY_FIX: Record<ScanRisk, string> = {
  BROKEN: 'This library exists to provide classical public-key cryptography. Each call site is a migration point; see the code findings.',
  REVIEW: 'Check which algorithms you use from it. RSA, ECDSA, ECDH, Ed25519 and X25519 are exposed; AES-256, SHA-2 and HMAC are not materially affected.',
  WEAKENED: '',
  CLASSICAL: '',
  PQ: 'A post-quantum library is a dependency. Confirm it is maintained and used in a hybrid.',
}

/* ---------- file classification ---------- */

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit', 'coverage', '__pycache__', '.venv', 'venv', 'env', '.tox', 'bower_components', 'Pods', 'third_party', 'third-party', '.terraform', '.gradle', '.idea', '.vscode', '.yarn', '.pnpm-store', 'site-packages'])
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'Gemfile.lock', 'composer.lock', 'uv.lock', 'flake.lock'])
const MANIFESTS = new Set(['package.json', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg', 'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json'])

const LANGUAGE_BY_EXT: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', m: 'Objective-C', mm: 'Objective-C', sol: 'Solidity', ex: 'Elixir', exs: 'Elixir',
  erl: 'Erlang', dart: 'Dart', lua: 'Lua', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', vue: 'Vue', svelte: 'Svelte',
}
const CONFIG_EXT = new Set(['yaml', 'yml', 'toml', 'json', 'ini', 'conf', 'cnf', 'cfg', 'xml', 'tf', 'hcl', 'properties', 'gradle', 'nginx'])
const KEY_EXT = new Set(['pem', 'key', 'crt', 'cer', 'pub', 'asc', 'gpg', 'p8'])
const CONFIG_NAMES = new Set(['Dockerfile', 'Makefile', 'sshd_config', 'ssh_config', 'nginx.conf', 'Caddyfile', 'httpd.conf'])

export type FileKind = 'code' | 'config' | 'key' | 'manifest'

export interface FileClass {
  kind: FileKind
  language: string
}

export type SkipReason = 'directory' | 'lockfile' | 'generated' | 'docs' | 'binary' | 'too-large' | 'secrets' | 'limit' | 'unsupported'

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|specs|testdata|test-data|fixtures?|examples?|samples?|benchmarks?|bench|e2e|demos?|docs?|cookbook|playground|tap)(?:\/|$)|\.(?:test|spec|bench)\.\w+$|_test\.go$|(?:^|\/)test_\w+\.py$/i
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*|#(?:\s|$)|<!--|--\s)/

/** Tests, examples, benchmarks and docs. Findings there are reported but ranked after application code. */
export function isTestPath(path: string) {
  return TEST_PATH.test(path)
}

/** Decides whether a path is read at all. Pure, so a browser can filter a folder before reading any file. */
export function classifyPath(path: string): FileClass | { skip: SkipReason } {
  const parts = path.split('/')
  const name = parts[parts.length - 1]
  if (parts.slice(0, -1).some((part) => SKIP_DIRS.has(part))) return { skip: 'directory' }
  if (LOCKFILES.has(name)) return { skip: 'lockfile' }
  if (/^\.env(?:\.|$)/.test(name)) return { skip: 'secrets' }
  if (MANIFESTS.has(name) || /^requirements[\w.-]*\.txt$/.test(name)) return { kind: 'manifest', language: 'Manifest' }
  if (/\.min\.(?:js|css)$|\.map$|\.bundle\.js$|\.d\.ts$|\.pb\.go$|_pb2\.py$/.test(name)) return { skip: 'generated' }
  if (CONFIG_NAMES.has(name)) return { kind: 'config', language: 'Config' }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (LANGUAGE_BY_EXT[ext]) return { kind: 'code', language: LANGUAGE_BY_EXT[ext] }
  if (CONFIG_EXT.has(ext)) return { kind: 'config', language: 'Config' }
  if (KEY_EXT.has(ext)) return { kind: 'key', language: 'Keys and certificates' }
  if (['md', 'mdx', 'rst', 'txt', 'adoc', 'html', 'htm', 'css', 'scss', 'svg'].includes(ext)) return { skip: 'docs' }
  return { skip: 'unsupported' }
}

/* ---------- repository input ---------- */

export interface RepoRef {
  owner: string
  name: string
  ref: string | null
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._/-]{1,120}$/

/** Accepts owner/name, github.com URLs (with /tree/<ref>), and .git suffixes. Returns null for anything else. */
export function parseRepoInput(input: string, ref?: string | null): RepoRef | null {
  let text = input.trim().replace(/^git@github\.com:/i, '').replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
  text = text.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const [owner, rawName, kind, ...rest] = text.split('/')
  const name = rawName?.replace(/\.git$/i, '')
  if (!owner || !name || !OWNER.test(owner) || !REPO.test(name) || name === '.' || name === '..') return null
  const fromUrl = kind === 'tree' && rest.length ? rest.join('/') : null
  const chosen = (ref?.trim() || fromUrl || null) as string | null
  if (chosen && (!REF.test(chosen) || chosen.includes('..') || chosen.startsWith('/'))) return null
  return { owner, name, ref: chosen }
}

/* ---------- scanning ---------- */

export interface ScanLocation {
  path: string
  line: number
  excerpt: string
  /** In tests, examples, benchmarks or docs. */
  test: boolean
  comment: boolean
  /** A post-quantum primitive appears on the same line, so this is likely one half of a hybrid. */
  hybrid: boolean
}

export interface SurfaceResult {
  ruleId: string
  title: string
  surface: ScanSurface
  risk: ScanRisk
  harvestNow: boolean
  inApp: boolean
  why: string
  fix: string
  standard: string | null
  occurrences: number
  files: number
  /** Occurrences in application code: not tests or examples, not comments, not already in a hybrid. */
  sourceOccurrences: number
  hybridOccurrences: number
  locations: ScanLocation[]
}

export interface DependencyResult {
  name: string
  ecosystem: Ecosystem
  manifest: string
  risk: ScanRisk
  provides: string
  fix: string
}

export interface AppScanSource {
  kind: 'github' | 'local' | 'paste'
  label: string
  ref?: string | null
  commit?: string | null
  url?: string | null
}

export interface AppScanReport {
  version: string
  source: AppScanSource
  scannedAt: string
  durationMs: number
  stats: {
    filesSeen: number
    filesScanned: number
    bytesScanned: number
    skipped: Partial<Record<SkipReason, number>>
    languages: Record<string, number>
    truncated: string | null
  }
  summary: {
    verdict: string
    vulnerable: number
    vulnerableInCode: number
    /** Classical uses that sit beside a post-quantum primitive. */
    hybrid: number
    vulnerableFiles: number
    harvestNow: number
    outsideApp: number
    weakened: number
    classical: number
    review: number
    postQuantum: number
  }
  surfaces: SurfaceResult[]
  dependencies: DependencyResult[]
  limitations: string[]
}

const SECRET_LITERAL = /(["'`])[A-Za-z0-9+/=_-]{32,}\1/g
const LONG_HEX = /\b(?:0x)?[0-9a-fA-F]{64,}\b/g
/** JWK private members and anything assigned to a name that sounds secret. */
const SECRET_FIELD = /((["']?)(?:k|d|p|q|dp|dq|qi|\w*(?:secret|private|passw(?:or)?d|seed|mnemonic|token|api_?key)\w*)\2\s*[:=]\s*)(["'`])[^"'`]{6,}\3/gi

/** The matched line, trimmed to 160 characters around the match, with anything that looks like key material removed. */
function excerptOf(line: string, match: string, redact: boolean) {
  if (redact) return match
  let text = line.replace(/\t/g, '  ').trim()
  if (text.length > 160) {
    const start = Math.max(0, Math.min(text.indexOf(match) - 50, text.length - 160))
    text = `${start > 0 ? '…' : ''}${text.slice(start, start + 160)}${start + 160 < text.length ? '…' : ''}`
  }
  return text.replace(SECRET_FIELD, '$1$3…redacted…$3').replace(SECRET_LITERAL, '$1…redacted…$1').replace(LONG_HEX, '…redacted…')
}

interface Accumulator {
  occurrences: number
  sourceOccurrences: number
  hybridOccurrences: number
  files: Set<string>
  locations: ScanLocation[]
}

function isGenerated(text: string) {
  if (text.length < 20_000) return false
  const lines = text.split('\n', 50)
  const long = lines.filter((line) => line.length > 1000).length
  return long > 0 && long >= lines.length / 4
}

export class AppScanner {
  private readonly started = Date.now()
  private readonly hits = new Map<string, Accumulator>()
  private readonly deps = new Map<string, DependencyResult>()
  private readonly vulnerableFiles = new Set<string>()
  private truncated: string | null = null
  readonly stats = { filesSeen: 0, filesScanned: 0, bytesScanned: 0, skipped: {} as Partial<Record<SkipReason, number>>, languages: {} as Record<string, number> }

  skip(reason: SkipReason) {
    this.stats.skipped[reason] = (this.stats.skipped[reason] ?? 0) + 1
  }

  /** Call once per file before reading it. Returns the class to read it as, or null to skip it. */
  admit(path: string, size: number): FileClass | null {
    this.stats.filesSeen += 1
    const result = classifyPath(path)
    if ('skip' in result) {
      this.skip(result.skip)
      return null
    }
    if (size > SCAN_LIMITS.maxFileBytes) {
      this.skip('too-large')
      return null
    }
    if (this.stats.filesScanned >= SCAN_LIMITS.maxFilesScanned) {
      this.skip('limit')
      this.markTruncated(`Stopped after ${SCAN_LIMITS.maxFilesScanned.toLocaleString('en-US')} files.`)
      return null
    }
    return result
  }

  markTruncated(reason: string) {
    this.truncated ??= reason
  }

  get full() {
    return this.stats.filesScanned >= SCAN_LIMITS.maxFilesScanned
  }

  /** Scans one admitted file. */
  addFile(path: string, text: string, kind: FileClass) {
    if (text.slice(0, 4000).includes('\u0000')) {
      this.skip('binary')
      return
    }
    if (kind.kind !== 'key' && kind.kind !== 'manifest' && isGenerated(text)) {
      this.skip('generated')
      return
    }
    this.stats.filesScanned += 1
    this.stats.bytesScanned += text.length
    this.stats.languages[kind.language] = (this.stats.languages[kind.language] ?? 0) + 1
    if (kind.kind === 'manifest') this.scanManifest(path, text)
    const rules = kind.kind === 'key' ? KEY_RULES : kind.kind === 'manifest' ? MANIFEST_RULES : SCAN_RULES
    const test = isTestPath(path)
    const perFile = new Map<string, number>()
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index]
      if (!raw) continue
      const line = raw.length > SCAN_LIMITS.maxLineChars ? raw.slice(0, SCAN_LIMITS.maxLineChars) : raw
      let comment: boolean | null = null
      let pqLine: boolean | null = null
      const matched: string[] = []
      for (const rule of rules) {
        const match = rule.pattern.exec(line)
        if (!match) continue
        if (rule.unless?.some((id) => matched.includes(id))) continue
        matched.push(rule.id)
        comment ??= kind.kind === 'code' && COMMENT_LINE.test(line)
        const hybrid = rule.risk === 'BROKEN' && !rule.redact && (pqLine ??= PQ_RULE.pattern.test(line))
        const seen = perFile.get(rule.id) ?? 0
        perFile.set(rule.id, seen + 1)
        const entry = this.hits.get(rule.id) ?? { occurrences: 0, sourceOccurrences: 0, hybridOccurrences: 0, files: new Set<string>(), locations: [] }
        entry.occurrences += 1
        if (hybrid) entry.hybridOccurrences += 1
        else if (!test && !comment) entry.sourceOccurrences += 1
        entry.files.add(path)
        if (seen < SCAN_LIMITS.occurrencesPerFile && entry.locations.length < SCAN_LIMITS.locationsPerSurface * 4) {
          entry.locations.push({ path, line: index + 1, excerpt: excerptOf(line, match[0], Boolean(rule.redact)), test, comment, hybrid })
        }
        this.hits.set(rule.id, entry)
        if (rule.risk === 'BROKEN') this.vulnerableFiles.add(path)
      }
    }
  }

  private addDependency(name: string, ecosystem: Ecosystem, manifest: string) {
    const known = LIBRARIES.find((item) => item.ecosystem === ecosystem && item.name === name.toLowerCase())
    if (!known) return
    const key = `${ecosystem}:${known.name}`
    if (this.deps.has(key)) return
    this.deps.set(key, { name: known.name, ecosystem, manifest, risk: known.risk, provides: known.provides, fix: LIBRARY_FIX[known.risk] })
  }

  private scanManifest(path: string, text: string) {
    const name = path.split('/').pop() ?? path
    const add = (dep: string, ecosystem: Ecosystem) => this.addDependency(dep, ecosystem, path)
    if (name === 'package.json') {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          const deps = parsed[field]
          if (deps && typeof deps === 'object') for (const dep of Object.keys(deps)) add(dep, 'npm')
        }
      } catch {
        // An unparseable package.json contributes nothing.
      }
      return
    }
    if (name === 'composer.json') {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        for (const field of ['require', 'require-dev']) {
          const deps = parsed[field]
          if (deps && typeof deps === 'object') for (const dep of Object.keys(deps)) add(dep, 'composer')
        }
      } catch {
        // As above.
      }
      return
    }
    if (name === 'go.mod') {
      for (const match of text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v/gim)) {
        const module = match[1].replace(/\/v\d+$/, '')
        add(LIBRARIES.find((item) => item.ecosystem === 'go' && (module === item.name || module.startsWith(`${item.name}/`)))?.name ?? module, 'go')
      }
      return
    }
    if (name === 'Cargo.toml') {
      let inDeps = false
      for (const line of text.split(/\r?\n/)) {
        const section = line.match(/^\s*\[([^\]]+)\]/)
        if (section) {
          inDeps = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(section[1].trim())
          const table = section[1].match(/dependencies\.([A-Za-z0-9_-]+)$/)
          if (table) add(table[1], 'cargo')
          continue
        }
        const dep = inDeps && line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)
        if (dep) add(dep[1], 'cargo')
      }
      return
    }
    if (name === 'Gemfile') {
      for (const match of text.matchAll(/^\s*gem\s+['"]([A-Za-z0-9_-]+)['"]/gm)) add(match[1], 'gem')
      return
    }
    if (name === 'pom.xml' || name.startsWith('build.gradle')) {
      for (const match of text.matchAll(/<artifactId>\s*([A-Za-z0-9._-]+)\s*<\/artifactId>|['"][\w.-]+:([\w.-]+):[\w.${}-]+['"]/g)) add(match[1] ?? match[2], 'maven')
      if (/org\.web3j/.test(text)) add('web3j', 'maven')
      return
    }
    for (const dep of pythonDependencies(name, text)) add(dep, 'pypi')
  }

  report(source: AppScanSource): AppScanReport {
    const surfaces: SurfaceResult[] = []
    for (const [ruleId, entry] of this.hits) {
      const rule = RULE_BY_ID[ruleId]
      const rank = (location: ScanLocation) => (location.test ? 4 : 0) + (location.hybrid ? 2 : 0) + (location.comment ? 1 : 0)
      const locations = [...entry.locations].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.line - b.line).slice(0, SCAN_LIMITS.locationsPerSurface)
      surfaces.push({
        ruleId,
        title: rule.title,
        surface: rule.surface,
        risk: rule.risk,
        harvestNow: rule.harvestNow,
        inApp: rule.inApp,
        why: rule.why,
        fix: rule.fix,
        standard: rule.standard ?? null,
        occurrences: entry.occurrences,
        files: entry.files.size,
        sourceOccurrences: entry.sourceOccurrences,
        hybridOccurrences: entry.hybridOccurrences,
        locations,
      })
    }
    surfaces.sort(
      (a, b) =>
        RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) ||
        SURFACE_ORDER.indexOf(a.surface) - SURFACE_ORDER.indexOf(b.surface) ||
        Number(b.sourceOccurrences > 0) - Number(a.sourceOccurrences > 0) ||
        b.occurrences - a.occurrences,
    )
    const dependencies = [...this.deps.values()].sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || a.name.localeCompare(b.name))

    const sum = (filter: (surface: SurfaceResult) => boolean) => surfaces.filter(filter).reduce((total, surface) => total + surface.occurrences, 0)
    const vulnerable = sum((surface) => surface.risk === 'BROKEN')
    const postQuantum = sum((surface) => surface.risk === 'PQ') + dependencies.filter((dep) => dep.risk === 'PQ').length
    const summary = {
      verdict: '',
      vulnerable,
      vulnerableInCode: surfaces.filter((surface) => surface.risk === 'BROKEN').reduce((total, surface) => total + surface.sourceOccurrences, 0),
      hybrid: surfaces.filter((surface) => surface.risk === 'BROKEN').reduce((total, surface) => total + surface.hybridOccurrences, 0),
      vulnerableFiles: this.vulnerableFiles.size,
      harvestNow: sum((surface) => surface.risk === 'BROKEN' && surface.harvestNow),
      outsideApp: sum((surface) => surface.risk === 'BROKEN' && !surface.inApp),
      weakened: sum((surface) => surface.risk === 'WEAKENED'),
      classical: sum((surface) => surface.risk === 'CLASSICAL'),
      review: dependencies.filter((dep) => dep.risk === 'REVIEW').length,
      postQuantum,
    }
    const brokenDeps = dependencies.filter((dep) => dep.risk === 'BROKEN').length
    const inCode = summary.vulnerableInCode
    summary.verdict =
      this.stats.filesScanned === 0
        ? 'Nothing scannable was found.'
        : inCode > 0
          ? `${plural(inCode, 'quantum-vulnerable use')} in application code.`
          : vulnerable > 0
            ? 'No quantum-vulnerable cryptography in application code.'
            : brokenDeps > 0
              ? `${plural(brokenDeps, 'dependency', 'dependencies')} built on classical public-key cryptography.`
              : postQuantum > 0
                ? 'No classical public-key cryptography found, and post-quantum primitives are referenced.'
                : 'No classical public-key cryptography found in the scanned code.'

    return {
      version: APP_SCAN_VERSION,
      source,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - this.started,
      stats: { ...this.stats, skipped: { ...this.stats.skipped }, languages: { ...this.stats.languages }, truncated: this.truncated },
      summary,
      surfaces,
      dependencies,
      limitations: [
        'Pattern matching on source text. Code is not executed, compiled or traced, so expect some false positives and misses.',
        'Cryptography inside dependencies, the runtime, your host or your CDN is not visible. TLS terminated by a provider must be checked there.',
        'Vendored, generated, minified and dependency directories are skipped, as are documentation, lockfiles and .env files.',
        'Review each finding before acting on it.',
      ],
    }
  }
}

const REQUIREMENT = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~@;(]|$)/
const QUOTED_REQUIREMENT = /["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~@;(][^"']*)?["']/g

/** Package names from Python manifests, read only from dependency positions so prose is never mistaken for a package. */
function pythonDependencies(name: string, text: string): string[] {
  const found: string[] = []
  const lines = text.split(/\r?\n/)
  if (/^requirements[\w.-]*\.txt$/.test(name)) {
    for (const line of lines) {
      if (/^\s*(?:#|-)/.test(line)) continue
      const match = line.match(REQUIREMENT)
      if (match) found.push(match[1])
    }
  } else if (name === 'setup.py') {
    for (const block of text.matchAll(/(?:install_requires|extras_require)\s*=\s*[[{]([\s\S]*?)[\]}]\s*[,)]/g)) for (const match of block[1].matchAll(QUOTED_REQUIREMENT)) found.push(match[1])
  } else {
    // pyproject.toml, Pipfile and setup.cfg: dependency tables, dependency arrays and install_requires blocks.
    let table = false
    let array = false
    let indented = false
    for (const line of lines) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
      if (header) {
        const section = header[1].trim()
        table = /(?:^|\.)(?:dev-|optional-)?dependencies$|^(?:dev-)?packages$|\.group\.[\w-]+\.dependencies$/.test(section)
        array = false
        indented = false
        continue
      }
      if (array) {
        for (const match of line.matchAll(QUOTED_REQUIREMENT)) found.push(match[1])
        if (line.includes(']')) array = false
        continue
      }
      if (indented) {
        if (/^\s+\S/.test(line)) {
          const match = line.match(REQUIREMENT)
          if (match) found.push(match[1])
          continue
        }
        indented = false
      }
      const opens = line.match(/^\s*([\w-]*(?:dependencies|requires))\s*=\s*\[(.*)$/)
      if (opens) {
        for (const match of opens[2].matchAll(QUOTED_REQUIREMENT)) found.push(match[1])
        array = !opens[2].includes(']')
        continue
      }
      if (/^\s*install_requires\s*=\s*$/.test(line)) {
        indented = true
        continue
      }
      if (table) {
        const key = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/)
        if (key && key[1] !== 'python') found.push(key[1])
        const inline = line.match(/=\s*\[(.*)$/)
        if (inline) {
          for (const match of inline[1].matchAll(QUOTED_REQUIREMENT)) found.push(match[1])
          array = !inline[1].includes(']')
        }
      }
    }
  }
  return found.map((dep) => dep.toLowerCase().replace(/_/g, '-'))
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** Convenience for pasted code and tests. */
export function scanTexts(files: { path: string; text: string }[], source: AppScanSource): AppScanReport {
  const scanner = new AppScanner()
  for (const file of files) {
    const kind = scanner.admit(file.path, file.text.length)
    if (kind) scanner.addFile(file.path, file.text, kind)
  }
  return scanner.report(source)
}

/* ---------- export ---------- */

export function locationUrl(source: AppScanSource, location: ScanLocation) {
  if (source.kind !== 'github' || !source.url) return null
  const tree = source.commit ?? source.ref ?? 'HEAD'
  return `${source.url}/blob/${tree}/${location.path.split('/').map(encodeURIComponent).join('/')}#L${location.line}`
}

export function reportToMarkdown(report: AppScanReport) {
  const lines: string[] = []
  const source = report.source
  lines.push(`# Quantum exposure report: ${source.label}`, '')
  if (source.commit) lines.push(`Commit \`${source.commit}\``)
  lines.push(`Scanned ${report.stats.filesScanned.toLocaleString('en-US')} files on ${report.scannedAt.slice(0, 10)} with Quantum Fork app scan v${report.version}.`, '')
  lines.push(`**${report.summary.verdict}**`, '')
  for (const surface of report.surfaces) {
    lines.push(`## ${surface.title} · ${RISK_LABEL[surface.risk]}`, '')
    lines.push(`${surface.occurrences} occurrence${surface.occurrences === 1 ? '' : 's'} in ${surface.files} file${surface.files === 1 ? '' : 's'}.${surface.harvestNow ? ' Harvest-now-decrypt-later risk.' : ''}${surface.inApp ? '' : ' Cannot be fixed inside the app alone.'}`, '')
    lines.push(`- Why: ${surface.why}`, `- Fix: ${surface.fix}`)
    if (surface.standard) lines.push(`- Standard: ${surface.standard}`)
    lines.push('')
    for (const location of surface.locations.slice(0, 15)) lines.push(`- \`${location.path}:${location.line}\`${location.test ? ' (test)' : ''}`)
    lines.push('')
  }
  if (report.dependencies.length) {
    lines.push('## Dependencies', '')
    for (const dep of report.dependencies) lines.push(`- \`${dep.name}\` (${dep.ecosystem}, ${dep.manifest}): ${dep.provides}. ${RISK_LABEL[dep.risk]}.`)
    lines.push('')
  }
  lines.push('## Limitations', '', ...report.limitations.map((item) => `- ${item}`), '')
  return lines.join('\n')
}
