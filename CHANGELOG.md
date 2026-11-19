# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue o [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] — 2026-11-19

### Adicionado
- Fila de transcrição com arrastar e soltar, pausa, cancelamento e nova tentativa.
- Conversão de áudio e vídeo com FFmpeg (WAV, MP3, M4A, OPUS, FLAC, MP4, MKV, MOV e outros).
- Transcrição local com whisper.cpp, acelerada por CUDA em placas NVIDIA e com alternativa automática no processador.
- Modelos Whisper `tiny` a `large-v3`, com download, troca e exclusão pela interface.
- Exportação em TXT, SRT, VTT, DOCX e JSON, salva ao lado do arquivo original ou numa pasta escolhida.
- Editor de transcrição com player, busca, pulo por horário e correção do texto.
- Campo de vocabulário, detecção de voz (pular silêncios) e marcação de tempo.
- Monitor de uso da GPU e da memória de vídeo.
- Integração com o Voxa (gravador agendado): importar gravações e transcrever as novas automaticamente.
- Notificações do Windows ao terminar.
