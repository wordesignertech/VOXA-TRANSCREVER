#!/usr/bin/env bash
# Baixa o que o Voxa Transcrever precisa para rodar e ser empacotado para Windows.
# Requer: bash, curl, unzip. Opcional: python/pip (runtime do Visual C++).
set -euo pipefail
cd "$(dirname "$0")/.."

ELECTRON_VERSION="33.4.11"
WHISPER_VERSION="v1.9.2"
FFMPEG_ZIP="ffmpeg-master-latest-win64-lgpl"

mkdir -p cache vendor/motor-cpu vendor/bin

baixar() { # url destino
  if [ -f "$2" ]; then echo "  já existe: $2"; return; fi
  echo "  baixando $(basename "$2")…"
  curl -fL --retry 3 -# -o "$2.part" "$1" && mv "$2.part" "$2"
}

echo "1/4 Electron $ELECTRON_VERSION (Windows x64)"
baixar "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-win32-x64.zip" cache/electron-win.zip

echo "2/4 whisper.cpp $WHISPER_VERSION (motor do processador)"
baixar "https://github.com/ggml-org/whisper.cpp/releases/download/$WHISPER_VERSION/whisper-bin-x64.zip" cache/whisper-cpu.zip
rm -rf cache/whisper-cpu && unzip -q -o cache/whisper-cpu.zip -d cache/whisper-cpu
cp cache/whisper-cpu/Release/whisper-cli.exe vendor/motor-cpu/
for f in cache/whisper-cpu/Release/*.dll; do
  case "$(basename "$f")" in SDL2.dll|parakeet.dll) ;; *) cp "$f" vendor/motor-cpu/ ;; esac
done

echo "3/4 FFmpeg (build LGPL)"
baixar "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$FFMPEG_ZIP.zip" cache/ffmpeg.zip
unzip -q -o -j cache/ffmpeg.zip "$FFMPEG_ZIP/bin/ffmpeg.exe" "$FFMPEG_ZIP/LICENSE.txt" -d cache/ffmpeg
cp cache/ffmpeg/ffmpeg.exe vendor/bin/
cp cache/ffmpeg/LICENSE.txt vendor/bin/FFMPEG-LICENSE.txt

echo "4/4 Runtime do Visual C++"
PIP=""; for c in pip pip3 "python -m pip" "py -m pip"; do if $c --version >/dev/null 2>&1; then PIP="$c"; break; fi; done
if [ -n "$PIP" ]; then
  mkdir -p cache/vc && $PIP download msvc-runtime --platform win_amd64 --only-binary=:all: --no-deps -q -d cache/vc
  rm -rf cache/vc/x && unzip -q -o -j cache/vc/*.whl "*/Scripts/msvcp140.dll" "*/Scripts/msvcp140_1.dll" "*/Scripts/msvcp140_2.dll" "*/Scripts/vcomp140.dll" "*/Scripts/vcruntime140.dll" "*/Scripts/vcruntime140_1.dll" -d cache/vc/x
  cp cache/vc/x/*.dll vendor/motor-cpu/
else
  echo "  pip não encontrado: o pacote vai depender do Visual C++ Redistributable instalado no Windows."
fi

echo "Pronto. Agora: npm run build:win"
