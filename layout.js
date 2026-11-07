// Coordinates use a fixed, low-resolution 640 × 360 side-view stage.
// Edge strips are drawn again in front of the player to conceal each crossing.
window.ALLEY = {
  width: 640,
  height: 360,
  initial: "alley",
  speed: 82,
  playerHeight: 48,
  heroFaces: "right",
  hero: { image: "assets/hero.png", frames: 4, frameWidth: 30, frameHeight: 48, fps: 8 },
  locations: {
    station: {
      name: "车站 · 站内",
      image: "assets/station.png",
      groundY: 304,
      spawnX: 320,
      neighbors: { left: null, right: "alley" },
      occlusion: { left: 40, right: 40 },
      walls: [{ id: "ship", name: "旅行海报", image: "assets/ship.png", interactX: 396, quad: [[373,166],[418,166],[418,233],[373,233]] }]
    },
    alley: {
      name: "里弄",
      image: "assets/alley.png",
      groundY: 325,
      spawnX: 320,
      neighbors: { left: "station", right: "cinema" },
      occlusion: { left: 40, right: 40 },
      walls: [{ id: "swallow", name: "燕子海报", image: "assets/swallow.png", interactX: 381, quad: [[350,177],[412,177],[412,261],[350,261]] }]
    },
    cinema: {
      name: "影院门口",
      image: "assets/cinema.png",
      groundY: 330,
      spawnX: 320,
      neighbors: { left: "alley", right: null },
      occlusion: { left: 40, right: 40 },
      walls: [{ id: "portrait", name: "电影海报", image: "assets/portrait.png", interactX: 423, quad: [[395,186],[451,186],[451,266],[395,266]] }]
    }
  }
};
