function scaleOcrWordBoxes(words, scaleX, scaleY) {
  return words.map((word) => {
    if (!word.bbox) return word;
    return {
      ...word,
      bbox: {
        x0: word.bbox.x0 / scaleX,
        y0: word.bbox.y0 / scaleY,
        x1: word.bbox.x1 / scaleX,
        y1: word.bbox.y1 / scaleY
      }
    };
  });
}

module.exports = { scaleOcrWordBoxes };