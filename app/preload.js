'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const on = (ch) => (fn) => { const h = (e, p) => fn(p); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('vt', {
  state: inv('state'), settings: inv('settings'), pickFiles: inv('pick-files'), addFiles: inv('add-files'), pickFolder: inv('pick-folder'),
  jobCancel: inv('job-cancel'), jobRetry: inv('job-retry'), jobRemove: inv('job-remove'), jobsClear: inv('jobs-clear'), queuePause: inv('queue-pause'),
  modelDownload: inv('model-download'), modelCancel: inv('model-cancel'), modelDelete: inv('model-delete'),
  cudaInstall: inv('cuda-install'), cudaCancel: inv('cuda-cancel'),
  transcript: inv('transcript'), transcriptSave: inv('transcript-save'), transcriptDelete: inv('transcript-delete'),
  exportAs: inv('export'), copyText: inv('copy-text'), reveal: inv('reveal'), openPath: inv('open-path'), voxaList: inv('voxa-list'), gpuRefresh: inv('gpu-refresh'),
  win: (a) => ipcRenderer.send('win', a),
  pathFor: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return f.path || ''; } },
  onState: on('state'), onJob: on('job'), onGpu: on('gpu'), onDownload: on('download'), onMax: on('maximized')
});
