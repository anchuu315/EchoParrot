// background.js - EchoParrot v1.5 Beta
// アイコンクリックで独立ウィンドウを開く（音声のみ / 映像+音声 両対応）

let recorderWindowId = null;
let targetTabId      = null;
let targetTabTitle   = null;

// アイコンクリックでウィンドウを開く/前面に出す
chrome.action.onClicked.addListener(async (tab) => {
  targetTabId    = tab.id;
  targetTabTitle = tab.title;

  if (recorderWindowId !== null) {
    try {
      await chrome.windows.update(recorderWindowId, { focused: true });
      return;
    } catch (e) {
      recorderWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('recorder.html'),
    type: 'popup',
    width: 360,
    height: 490,   // 映像プレビュー分を考慮して高さを拡張
    focused: true
  });

  recorderWindowId = win.id;
});

// ウィンドウが閉じられたらIDをリセット
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === recorderWindowId) recorderWindowId = null;
});

// recorder.htmlからのメッセージ処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startCapture') {
    if (!targetTabId) {
      sendResponse({
        success: false,
        error: '録音対象のタブが見つかりません。ウィンドウを閉じてアイコンを再クリックしてください。'
      });
      return true;
    }

    // video フラグを受け取り tabCapture に渡す
    const videoRequested = message.video === true;

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: targetTabId },
      (streamId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({
            success: true,
            streamId,
            tabTitle: targetTabTitle || '',
            video: videoRequested
          });
        }
      }
    );
    return true;
  }
});
