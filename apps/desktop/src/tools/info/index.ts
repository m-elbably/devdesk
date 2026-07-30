import base64 from './base64.md?raw'
import basicAuth from './basic-auth.md?raw'
import byteConverter from './byte-converter.md?raw'
import cacheControl from './cache-control.md?raw'
import cookieParser from './cookie-parser.md?raw'
import curlConverter from './curl-converter.md?raw'
import caseConverter from './case-converter.md?raw'
import codeEscape from './code-escape.md?raw'
import certParser from './cert-parser.md?raw'
import colorConverter from './color-converter.md?raw'
import cronGenerator from './cron-generator.md?raw'
import dateCalculator from './date-calculator.md?raw'
import isoDurationInfo from './iso-duration.md?raw'
import emailNormalizer from './email-normalizer.md?raw'
import encryption from './encryption.md?raw'
import eta from './eta.md?raw'
import hash from './hash.md?raw'
import hmac from './hmac.md?raw'
import hexConverter from './hex-converter.md?raw'
import htmlEscape from './html-escape.md?raw'
import httpStatus from './http-status.md?raw'
import jsonDiff from './json-diff.md?raw'
import jsonToTs from './json-to-ts.md?raw'
import cidrCalculator from './cidr-calculator.md?raw'
import ipConverter from './ip-converter.md?raw'
import macGenerator from './mac-generator.md?raw'
import macInspector from './mac-inspector.md?raw'
import subnetSplitter from './subnet-splitter.md?raw'
import ipRangeCidr from './ip-range-cidr.md?raw'
import cidrMatcher from './cidr-matcher.md?raw'
import portReference from './port-reference.md?raw'
import jsonYaml from './json-yaml.md?raw'
import jsonCsv from './json-csv.md?raw'
import jsonLines from './json-lines.md?raw'
import jsonEditor from './json-editor.md?raw'
import uuidInspector from './uuid-inspector.md?raw'
import randomPort from './random-port.md?raw'
import gitCheatsheet from './git-cheatsheet.md?raw'
import chmodCalculator from './chmod-calculator.md?raw'
import xmlJson from './xml-json.md?raw'
import envJson from './env-json.md?raw'
import svgPlaceholder from './svg-placeholder.md?raw'
import timestamp from './timestamp.md?raw'
import timezoneConverter from './timezone-converter.md?raw'
import durationCalculator from './duration-calculator.md?raw'
import jwtParser from './jwt-parser.md?raw'
import jwtSigner from './jwt-signer.md?raw'
import password from './password.md?raw'
import passwordStrength from './password-strength.md?raw'
import percentage from './percentage.md?raw'
import qrCode from './qr-code.md?raw'
import regexTester from './regex-tester.md?raw'
import rsaKeypair from './rsa-keypair.md?raw'
import slugify from './slugify.md?raw'
import token from './token.md?raw'
import totpHotp from './totp-hotp.md?raw'
import ulid from './ulid.md?raw'
import urlEncoder from './url-encoder.md?raw'
import urlParser from './url-parser.md?raw'
import userAgent from './user-agent.md?raw'
import unicodeInspector from './unicode-inspector.md?raw'
import uuid from './uuid.md?raw'
import wifiQr from './wifi-qr.md?raw'
import stats from './stats.md?raw'
import slaUptime from './sla-uptime.md?raw'
import baseConverter from './base-converter.md?raw'
import aspectRatio from './aspect-ratio.md?raw'
import transferTime from './transfer-time.md?raw'

export const TOOL_INFO: Record<string, string> = {
  base64,
  'basic-auth': basicAuth,
  'byte-converter': byteConverter,
  'case-converter': caseConverter,
  'code-escape': codeEscape,
  'cert-parser': certParser,
  'color-converter': colorConverter,
  'cron-generator': cronGenerator,
  'date-calculator': dateCalculator,
  'iso-duration': isoDurationInfo,
  'email-normalizer': emailNormalizer,
  encryption,
  eta,
  hash,
  hmac,
  'hex-converter': hexConverter,
  'html-escape': htmlEscape,
  'http-status': httpStatus,
  'json-diff': jsonDiff,
  'json-to-ts': jsonToTs,
  'cidr-calculator': cidrCalculator,
  'ip-converter': ipConverter,
  'mac-generator': macGenerator,
  'mac-inspector': macInspector,
  'subnet-splitter': subnetSplitter,
  'ip-range-cidr': ipRangeCidr,
  'cidr-matcher': cidrMatcher,
  'port-reference': portReference,
  'json-yaml': jsonYaml,
  'json-csv': jsonCsv,
  'json-lines': jsonLines,
  'json-editor': jsonEditor,
  'uuid-inspector': uuidInspector,
  'random-port': randomPort,
  'git-cheatsheet': gitCheatsheet,
  'chmod-calculator': chmodCalculator,
  'xml-json': xmlJson,
  'env-json': envJson,
  'svg-placeholder': svgPlaceholder,
  timestamp,
  'timezone-converter': timezoneConverter,
  'duration-calculator': durationCalculator,
  'jwt-parser': jwtParser,
  'jwt-signer': jwtSigner,
  password,
  'password-strength': passwordStrength,
  percentage,
  stats,
  'sla-uptime': slaUptime,
  'base-converter': baseConverter,
  'aspect-ratio': aspectRatio,
  'transfer-time': transferTime,
  'qr-code': qrCode,
  'regex-tester': regexTester,
  'rsa-keypair': rsaKeypair,
  slugify,
  token,
  'totp-hotp': totpHotp,
  ulid,
  'url-encoder': urlEncoder,
  'cache-control': cacheControl,
  'cookie-parser': cookieParser,
  'curl-converter': curlConverter,
  'url-parser': urlParser,
  'user-agent': userAgent,
  'unicode-inspector': unicodeInspector,
  uuid,
  'wifi-qr': wifiQr,
}

export function hasToolInfo(id: string): boolean {
  return id in TOOL_INFO
}
