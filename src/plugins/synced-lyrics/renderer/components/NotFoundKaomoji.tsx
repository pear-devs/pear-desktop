export const NotFoundKaomoji = () => {
  return (
    <yt-formatted-string
      class="text-lyrics description ytmusic-description-shelf-renderer"
      style={{
        'display': 'inline-flex',
        'justify-content': 'center',
        'width': '100%',
        'user-select': 'none',
      }}
      text={{
        runs: [{ text: '＼(〇_ｏ)／' }],
      }}
    />
  );
};
