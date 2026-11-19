# Componentes de terceiros

O pacote para Windows do Voxa Transcrever inclui ou baixa os componentes abaixo.
Cada um continua sob a sua própria licença.

| Componente | Uso | Licença | Origem |
|---|---|---|---|
| whisper.cpp v1.9.2 (motor CPU incluído; motor CUDA baixado sob demanda) | Transcrição | MIT | https://github.com/ggml-org/whisper.cpp |
| Modelos Whisper (formato ggml) | Reconhecimento de fala | MIT | https://huggingface.co/ggerganov/whisper.cpp |
| Silero VAD (formato ggml) | Detecção de voz | MIT | https://huggingface.co/ggml-org/whisper-vad |
| FFmpeg (build LGPL de BtbN) | Conversão de áudio e vídeo | LGPL 2.1 ou posterior | https://github.com/BtbN/FFmpeg-Builds · código-fonte: https://ffmpeg.org/download.html |
| NVIDIA CUDA Runtime e cuBLAS (dentro do motor CUDA) | Aceleração na GPU | NVIDIA CUDA EULA (redistribuível) | https://docs.nvidia.com/cuda/eula/ |
| Microsoft Visual C++ Runtime | Bibliotecas do motor | Microsoft Software License (redistribuível) | https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files |
| Electron 33 | Janela do aplicativo | MIT | https://github.com/electron/electron |
| docx | Geração de arquivos Word | MIT | https://github.com/dolanmiu/docx |
| Inter | Fonte da interface | SIL Open Font License 1.1 | https://github.com/rsms/inter |

## FFmpeg (LGPL)

O executável `resources/bin/ffmpeg.exe` é uma compilação LGPL sem modificações, usada como programa separado
(o app chama o `ffmpeg.exe`, não se liga às bibliotecas dele). O texto da licença acompanha o pacote em
`resources/bin/FFMPEG-LICENSE.txt`. O código-fonte correspondente está disponível em https://ffmpeg.org e
nos scripts de build em https://github.com/BtbN/FFmpeg-Builds. Você pode substituir o `ffmpeg.exe` por outra
compilação compatível.
