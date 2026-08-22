# Liest die VBA-Module aus einer .dotm: OLE-Stream sauber holen, dann MS-OVBA entpacken.
import io, sys, zipfile, olefile

def entpacke(daten):
    if not daten or daten[0] != 0x01: return b""
    aus = bytearray(); pos = 1
    while pos + 1 < len(daten):
        kopf = daten[pos] | (daten[pos+1] << 8); pos += 2
        laenge = (kopf & 0x0FFF) + 3
        komprimiert = (kopf >> 12) & 0x8   # Bit 15
        ende = pos + laenge - 2
        if ende > len(daten): ende = len(daten)
        if not komprimiert:
            aus += daten[pos:ende]; pos = ende; continue
        start = len(aus)
        while pos < ende:
            flags = daten[pos]; pos += 1
            for bit in range(8):
                if pos >= ende: break
                if not (flags >> bit) & 1:
                    aus.append(daten[pos]); pos += 1
                else:
                    token = daten[pos] | (daten[pos+1] << 8); pos += 2
                    diff = len(aus) - start
                    bits = 4
                    while (1 << bits) < diff: bits += 1
                    bits = min(max(bits, 4), 12)
                    lng = (token & (0xFFFF >> bits)) + 3
                    off = (token >> (16 - bits)) + 1
                    for _ in range(lng): aus.append(aus[len(aus) - off])
        pos = ende
    return bytes(aus)

pfad = sys.argv[1]
roh = zipfile.ZipFile(pfad).read("word/vbaProject.bin")
ole = olefile.OleFileIO(io.BytesIO(roh))
print("Streams:", ["/".join(p) for p in ole.listdir()])
for teil in ole.listdir():
    name = "/".join(teil)
    if not name.upper().startswith("VBA/"): continue
    if name.split("/")[-1] in ("_VBA_PROJECT", "dir"): continue
    daten = ole.openstream(teil).read()
    # Modul-Streams haben einen Kopf vor dem 0x01; erste Signatur suchen
    i = daten.find(b"\x01")
    txt = entpacke(daten[i:]) if i >= 0 else b""
    if b"Attribute VB_Name" in txt:
        print(f"\n########## {name} ({len(txt)} Bytes Quelltext) ##########")
        print(txt.decode("latin-1"))
