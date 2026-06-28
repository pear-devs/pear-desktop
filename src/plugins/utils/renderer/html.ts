const domParser = new DOMParser();

/**
 * Creates a DOM element from an HTML string
 * @param html The HTML string
 * @returns The DOM element
 */
export const ElementFromHtml = (html: string): HTMLElement => {
  return (domParser.parseFromString(html, 'text/html') as HTMLDocument).body
    .firstElementChild as HTMLElement;
};

/**
 * Creates a DOM element from a src string
 * @param src The source of the image
 * @returns The image element
 */
export const ImageElementFromSrc = (src: string): HTMLImageElement => {
  const image = document.createElement('img');
  image.src = src;
  return image;
};
