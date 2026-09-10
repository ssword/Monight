#!/usr/bin/env python3
"""Generate the protected PDF fixtures used by the native policy contracts."""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID
from pypdf import PdfWriter
from pypdf.constants import UserAccessPermissions
from pypdf.generic import (
    ArrayObject,
    ByteStringObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri/tests/fixtures/native-annotations/original.pdf"
OUTPUT = ROOT / "src-tauri/tests/fixtures/protected-documents"
PASSWORD = "monight-test-password"
BYTE_RANGE_PLACEHOLDER = 9_999_999_999
SIGNATURE_CAPACITY = 16_384


def write_encrypted_fixtures() -> None:
    restricted = PdfWriter(clone_from=SOURCE)
    restricted.encrypt(
        user_password="",
        owner_password=PASSWORD,
        permissions_flag=UserAccessPermissions.PRINT,
        algorithm="AES-128",
    )
    restricted.write(OUTPUT / "permission-restricted.pdf")

    encrypted = PdfWriter(clone_from=SOURCE)
    encrypted.encrypt(
        user_password=PASSWORD,
        owner_password=PASSWORD,
        permissions_flag=UserAccessPermissions(0xFFFFFFFC),
        algorithm="AES-256",
    )
    encrypted.write(OUTPUT / "password-encrypted.pdf")


def unsigned_signature_container() -> bytes:
    writer = PdfWriter(clone_from=SOURCE)
    signature = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Sig"),
            NameObject("/Filter"): NameObject("/Adobe.PPKLite"),
            NameObject("/SubFilter"): NameObject("/adbe.pkcs7.detached"),
            NameObject("/ByteRange"): ArrayObject(
                [NumberObject(BYTE_RANGE_PLACEHOLDER) for _ in range(4)]
            ),
            NameObject("/Contents"): ByteStringObject(bytes(SIGNATURE_CAPACITY)),
            NameObject("/M"): TextStringObject("D:20260910000000Z"),
            NameObject("/Reason"): TextStringObject("Monight protection fixture"),
        }
    )
    signature_ref = writer._add_object(signature)
    widget = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Sig"),
            NameObject("/T"): TextStringObject("FixtureSignature"),
            NameObject("/Rect"): ArrayObject([NumberObject(0) for _ in range(4)]),
            NameObject("/F"): NumberObject(132),
            NameObject("/V"): signature_ref,
        }
    )
    widget_ref = writer._add_object(widget)
    page = writer.pages[0]
    page[NameObject("/Annots")] = ArrayObject([widget_ref])
    acro_form = DictionaryObject(
        {
            NameObject("/SigFlags"): NumberObject(3),
            NameObject("/Fields"): ArrayObject([widget_ref]),
        }
    )
    writer._root_object[NameObject("/AcroForm")] = writer._add_object(acro_form)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def signing_identity() -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Monight fixture signer")])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(64)
        .not_valid_before(datetime(2026, 1, 1, tzinfo=timezone.utc))
        .not_valid_after(datetime(2036, 1, 1, tzinfo=timezone.utc))
        .sign(key, hashes.SHA256())
    )
    return key, certificate


def write_signed_fixture() -> None:
    document = bytearray(unsigned_signature_container())
    contents = re.search(rb"/Contents\s*<([0]+)>", document)
    byte_range = re.search(
        rb"/ByteRange\s*\[\s*9999999999\s+9999999999\s+9999999999\s+9999999999\s*\]",
        document,
    )
    if contents is None or byte_range is None:
        raise RuntimeError("Signature placeholders were not serialized as expected")

    contents_start = contents.start(1) - 1
    contents_end = contents.end(1) + 1
    values = (0, contents_start, contents_end, len(document) - contents_end)
    replacement = f"/ByteRange [{values[0]} {values[1]} {values[2]} {values[3]}]".encode()
    replacement += b" " * (len(byte_range.group()) - len(replacement))
    document[byte_range.start() : byte_range.end()] = replacement

    key, certificate = signing_identity()
    signed_bytes = bytes(document[:contents_start] + document[contents_end:])
    signature = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(signed_bytes)
        .add_signer(certificate, key, hashes.SHA256())
        .sign(
            serialization.Encoding.DER,
            [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary],
        )
    )
    signature_hex = signature.hex().encode()
    if len(signature_hex) > contents.end(1) - contents.start(1):
        raise RuntimeError("CMS signature exceeds the reserved PDF Contents field")
    document[contents.start(1) : contents.end(1)] = signature_hex.ljust(
        contents.end(1) - contents.start(1), b"0"
    )
    (OUTPUT / "digitally-signed.pdf").write_bytes(document)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_encrypted_fixtures()
    write_signed_fixture()


if __name__ == "__main__":
    main()
