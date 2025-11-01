export type Profile = {
  id: string;
  handleId: string;
  name: string;
  thumbnail: string;
};
export type VideoData = {
  videoId: string;
  ownerId: string;
};
export type Permission = 'host-only' | 'playlist' | 'all';

export const getDefaultProfile = (
  connectionID: string,
  id: string = Date.now().toString(),
): Profile => {
  const name = `Guest ${id.slice(0, 4)}`;

  return {
    id: connectionID,
    handleId: `#music-together:${id}`,
    name,
    thumbnail: `https://ui-avatars.com/api/?name=${name}&background=random`,
  };
};
