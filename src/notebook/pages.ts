/**
 * The notebook: one page per piece on the real physics behind it. Each page has a
 * small scene that is traced by the game's own optics engine, so the drawing is true.
 */
import type { Localized } from '../level/schema';
import type { PieceKind, WorldDef } from '../level/worlds';

export interface SceneDef {
  w: number;
  h: number;
  entities: { type: string; x: number; y: number; angle?: number; params?: Record<string, unknown> }[];
}

export interface NotebookPage {
  /** The piece this page is about; also the page id. */
  piece: PieceKind;
  /** The rule in one line. */
  law: Localized;
  text: Localized;
  /** Where the effect shows up outside the game. */
  wild: Localized;
  scene: SceneDef;
}

export const PAGES: NotebookPage[] = [
  {
    piece: 'mirror',
    law: { en: 'Angle in = angle out', de: 'Einfallswinkel = Ausfallswinkel' },
    text: {
      en: 'A mirror sends light back at the same angle it arrived, measured from a line standing straight up on the surface. Turn the mirror by 15° and the beam swings by 30°: twice as far.',
      de: 'Ein Spiegel wirft Licht im selben Winkel zurück, in dem es ankommt, gemessen an einer Linie senkrecht zur Oberfläche. Drehst du den Spiegel um 15°, schwenkt der Strahl um 30°: doppelt so weit.',
    },
    wild: {
      en: 'Astronauts left mirrors on the Moon. Lasers bounced off them measure its distance to within a few centimetres.',
      de: 'Astronauten haben Spiegel auf dem Mond zurückgelassen. Mit Lasern, die daran zurückprallen, misst man seine Entfernung auf wenige Zentimeter genau.',
    },
    scene: {
      w: 7,
      h: 4,
      entities: [
        { type: 'laser', x: 0, y: 2 },
        { type: 'mirror', x: 4, y: 2, angle: 45 },
        { type: 'sink', x: 4, y: 0 },
      ],
    },
  },
  {
    piece: 'splitter',
    law: { en: 'Half passes, half reflects', de: 'Die Hälfte geht durch, die Hälfte wird gespiegelt' },
    text: {
      en: 'A beam splitter is a mirror so thin that it lets half of the light through. Both beams carry half the brightness, and no light is lost.',
      de: 'Ein Strahlteiler ist ein so dünner Spiegel, dass er die Hälfte des Lichts durchlässt. Beide Strahlen sind halb so hell, und kein Licht geht verloren.',
    },
    wild: {
      en: 'A window at night does the same: you see the street and your own reflection at once.',
      de: 'Ein Fenster bei Nacht macht dasselbe: Du siehst die Straße und zugleich dein Spiegelbild.',
    },
    scene: {
      w: 7,
      h: 4,
      entities: [
        { type: 'laser', x: 0, y: 2 },
        { type: 'splitter', x: 3, y: 2, angle: 45 },
        { type: 'sink', x: 3, y: 0, params: { required: 0.45 } },
        { type: 'sink', x: 6, y: 2, params: { required: 0.45 } },
      ],
    },
  },
  {
    piece: 'lens',
    law: { en: 'Parallel light meets in the focus', de: 'Paralleles Licht trifft sich im Brennpunkt' },
    text: {
      en: 'A converging lens is thick in the middle. It bends rays more the further from its centre they pass, so parallel rays all meet in one point, the focus. It works backwards too: light spreading from the focus leaves the lens as a parallel band.',
      de: 'Eine Sammellinse ist in der Mitte dick. Sie lenkt Strahlen umso stärker ab, je weiter außen sie hindurchgehen, sodass sich parallele Strahlen in einem Punkt treffen, dem Brennpunkt. Es geht auch rückwärts: Licht, das sich vom Brennpunkt ausbreitet, verlässt die Linse als paralleles Band.',
    },
    wild: {
      en: 'A magnifying glass gathers sunlight into a point hot enough to scorch paper. The lens in your eye focuses the world onto your retina.',
      de: 'Ein Brennglas sammelt Sonnenlicht in einem Punkt, der heiß genug ist, um Papier zu versengen. Die Linse in deinem Auge bildet die Welt auf der Netzhaut ab.',
    },
    scene: {
      w: 7,
      h: 3,
      entities: [
        { type: 'sun', x: 0, y: 1, params: { width: 0.8, rays: 60 } },
        { type: 'lens', x: 2, y: 1, params: { f: 3 } },
        { type: 'sink', x: 5, y: 1, params: { required: 0.5 } },
      ],
    },
  },
  {
    piece: 'curvedMirror',
    law: { en: 'A mirror with a focus', de: 'Ein Spiegel mit Brennpunkt' },
    text: {
      en: 'A concave mirror is curved like the inside of a bowl. It gathers parallel light in a focus as a lens does, but sends it back the way it came. Because the light never passes through glass, all colours meet in exactly the same point.',
      de: 'Ein Hohlspiegel ist gewölbt wie das Innere einer Schale. Er sammelt paralleles Licht in einem Brennpunkt wie eine Linse, wirft es aber dorthin zurück, woher es kam. Weil das Licht nie durch Glas geht, treffen sich alle Farben in genau demselben Punkt.',
    },
    wild: {
      en: 'Every large telescope uses a concave mirror, and so do satellite dishes, torches and car headlights.',
      de: 'Jedes große Teleskop nutzt einen Hohlspiegel, ebenso Satellitenschüsseln, Taschenlampen und Autoscheinwerfer.',
    },
    scene: {
      w: 7,
      h: 3,
      entities: [
        // The ring sits in the incoming light, like the small second mirror of a telescope.
        { type: 'sun', x: 0, y: 1, params: { width: 0.8, rays: 60 } },
        { type: 'curvedMirror', x: 6, y: 1, angle: 180, params: { f: 2 } },
        { type: 'sink', x: 4, y: 1, params: { required: 0.3, radius: 0.16 } },
      ],
    },
  },
  {
    piece: 'divergingLens',
    law: { en: 'Light spreads as if from a point behind', de: 'Licht läuft auseinander wie von einem Punkt dahinter' },
    text: {
      en: 'A diverging lens is thin in the middle and thick at the rim. It spreads parallel rays apart, as if they all came from one point behind the lens. Paired with a converging lens it makes a beam narrower or wider while keeping it parallel.',
      de: 'Eine Zerstreuungslinse ist in der Mitte dünn und am Rand dick. Sie spreizt parallele Strahlen auseinander, als kämen sie alle aus einem Punkt hinter der Linse. Zusammen mit einer Sammellinse macht sie ein Lichtbündel schmaler oder breiter und hält es dabei parallel.',
    },
    wild: {
      en: 'Glasses for short-sighted people are diverging lenses. Galileo built his telescope from one diverging and one converging lens.',
      de: 'Brillen für Kurzsichtige sind Zerstreuungslinsen. Galilei baute sein Fernrohr aus einer Zerstreuungs- und einer Sammellinse.',
    },
    scene: {
      w: 7,
      h: 5,
      entities: [
        { type: 'sun', x: 0, y: 2, params: { width: 0.8, rays: 60 } },
        { type: 'lens', x: 2, y: 2, params: { f: -1.5 } },
      ],
    },
  },
  {
    piece: 'block',
    law: { en: 'Light slows down in glass, and bends', de: 'Licht wird in Glas langsamer und knickt ab' },
    text: {
      en: 'In glass, light travels at only two thirds of its speed in air. A beam entering at a slant bends towards the surface\'s upright line, and bends back on the way out, so it leaves parallel but shifted sideways. A beam inside the glass that meets the surface too flat cannot get out at all: it is reflected completely.',
      de: 'In Glas ist Licht nur zwei Drittel so schnell wie in Luft. Ein schräg eintretender Strahl knickt zur Senkrechten der Oberfläche hin ab und beim Austritt wieder zurück: Er läuft parallel weiter, aber seitlich versetzt. Trifft ein Strahl im Glas zu flach auf die Oberfläche, kommt er gar nicht hinaus: Er wird vollständig gespiegelt.',
    },
    wild: {
      en: 'A straw in a glass of water looks broken at the surface. Optical fibres carry the internet by trapping light with that complete reflection.',
      de: 'Ein Strohhalm im Wasserglas sieht an der Oberfläche geknickt aus. Glasfasern tragen das Internet, indem sie Licht mit dieser vollständigen Spiegelung einsperren.',
    },
    scene: {
      w: 7,
      h: 3,
      entities: [
        { type: 'laser', x: 0, y: 1 },
        { type: 'block', x: 3, y: 1, angle: 35, params: { size: 1.3 } },
      ],
    },
  },
  {
    piece: 'filter',
    law: { en: 'A filter only takes light away', de: 'Ein Filter nimmt nur Licht weg' },
    text: {
      en: 'White light is a mix of all colours. A red filter does not dye it: it swallows everything except red. Coloured lights add up instead: red and green light together look yellow, and red, green and blue together look white.',
      de: 'Weißes Licht ist eine Mischung aller Farben. Ein roter Filter färbt es nicht: Er verschluckt alles außer Rot. Farbige Lichter addieren sich dagegen: Rotes und grünes Licht zusammen sehen gelb aus, Rot, Grün und Blau zusammen weiß.',
    },
    wild: {
      en: 'Every pixel of the screen you are looking at is made of three tiny lights: one red, one green and one blue.',
      de: 'Jeder Bildpunkt des Bildschirms vor dir besteht aus drei winzigen Lichtern: einem roten, einem grünen und einem blauen.',
    },
    scene: {
      w: 7,
      h: 3,
      entities: [
        { type: 'laser', x: 0, y: 1 },
        { type: 'filter', x: 3, y: 1, params: { color: 'red' } },
        { type: 'sink', x: 6, y: 1, params: { color: 'red', required: 0.3 } },
      ],
    },
  },
  {
    piece: 'prism',
    law: { en: 'Blue bends more than red', de: 'Blau wird stärker gebrochen als Rot' },
    text: {
      en: 'Glass slows blue light a little more than red light, so blue bends further at each surface. A prism\'s slanted faces add the two bends up instead of undoing them, and white light fans out into its colours. A second prism can fold the fan back into white.',
      de: 'Glas bremst blaues Licht etwas stärker als rotes, darum knickt Blau an jeder Fläche weiter ab. Die schrägen Flächen eines Prismas addieren die beiden Knicke, statt sie aufzuheben, und weißes Licht fächert sich in seine Farben auf. Ein zweites Prisma kann den Fächer wieder zu Weiß zusammenlegen.',
    },
    wild: {
      en: 'In a rainbow, every raindrop is a tiny prism. Newton used two prisms in 1666 to show that the colours are in the light and not made by the glass.',
      de: 'Im Regenbogen ist jeder Regentropfen ein winziges Prisma. Newton zeigte 1666 mit zwei Prismen, dass die Farben im Licht stecken und nicht vom Glas gemacht werden.',
    },
    scene: {
      w: 8,
      h: 5,
      entities: [
        { type: 'laser', x: 0, y: 1 },
        { type: 'prism', x: 3, y: 1, angle: 45 },
      ],
    },
  },
  {
    piece: 'polarizer',
    law: { en: 'Brightness falls with the square of the cosine', de: 'Die Helligkeit fällt mit dem Quadrat des Kosinus' },
    text: {
      en: 'Light is a wave that swings sideways to its path, in any direction. A polarizer lets only one swing direction through: half of ordinary light. A second polarizer turned by an angle passes cos² of that angle: all at 0°, half at 45°, nothing at 90°. The paradox: slide a third one at 45° between two crossed polarizers and light comes through again, because each one sets a new swing direction.',
      de: 'Licht ist eine Welle, die quer zu ihrem Weg schwingt, in beliebiger Richtung. Ein Polarisator lässt nur eine Schwingungsrichtung durch: die Hälfte von gewöhnlichem Licht. Ein zweiter, verdrehter Polarisator lässt cos² des Winkels durch: alles bei 0°, die Hälfte bei 45°, nichts bei 90°. Das Paradox: Schiebt man einen dritten unter 45° zwischen zwei gekreuzte Polarisatoren, kommt wieder Licht durch, weil jeder eine neue Schwingungsrichtung festlegt.',
    },
    wild: {
      en: 'Polarizing sunglasses block the glare from water and roads, which swings mostly level with the ground. Every LCD screen has two polarizers with liquid crystals in between.',
      de: 'Polarisierende Sonnenbrillen sperren die Blendung von Wasser und Straßen aus, die überwiegend waagerecht schwingt. Jeder LCD-Bildschirm hat zwei Polarisatoren mit Flüssigkristallen dazwischen.',
    },
    scene: {
      w: 8,
      h: 3,
      entities: [
        { type: 'laser', x: 0, y: 1 },
        { type: 'polarizer', x: 2, y: 1, angle: 0 },
        { type: 'polarizer', x: 4, y: 1, angle: 45 },
        { type: 'sink', x: 7, y: 1, params: { required: 0.2 } },
      ],
    },
  },
  {
    piece: 'blackHole',
    law: { en: 'Gravity bends light', de: 'Schwerkraft krümmt Licht' },
    text: {
      en: 'Mass curves the space around it, and light follows the curve. The closer a beam passes, the more it turns: at half the distance, twice the angle. Light that comes nearer than about 2.6 times the hole\'s radius spirals in and never leaves. That dark disc is the shadow.',
      de: 'Masse krümmt den Raum um sich herum, und Licht folgt der Krümmung. Je näher ein Strahl vorbeiläuft, desto stärker biegt er ab: bei halbem Abstand um den doppelten Winkel. Licht, das näher als etwa das 2,6-Fache des Lochradius kommt, stürzt in einer Spirale hinein und kommt nie wieder heraus. Diese dunkle Scheibe ist der Schatten.',
    },
    wild: {
      en: 'During the solar eclipse of 1919, stars beside the Sun appeared shifted, just as Einstein had predicted. Distant galaxies bent around a nearer one show up as arcs and rings.',
      de: 'Bei der Sonnenfinsternis von 1919 erschienen Sterne neben der Sonne verschoben, genau wie Einstein es vorhergesagt hatte. Ferne Galaxien, deren Licht um eine nähere herumgebogen wird, erscheinen als Bögen und Ringe.',
    },
    scene: {
      w: 9,
      h: 6,
      entities: [
        { type: 'laser', x: 0, y: 1 },
        { type: 'laser', x: 0, y: 2 },
        { type: 'laser', x: 0, y: 3 },
        { type: 'blackHole', x: 4, y: 3, params: { reach: 3 } },
      ],
    },
  },
  {
    piece: 'grating',
    law: { en: 'Red bends more than blue', de: 'Rot wird stärker abgelenkt als Blau' },
    text: {
      en: 'A grating is a plate with thousands of fine lines. Light waves leaving the gaps between them only add up in certain directions: straight on, and to each side at an angle that grows with the wavelength. Red has the longest waves and is thrown furthest, the reverse of a prism.',
      de: 'Ein Gitter ist eine Platte mit Tausenden feiner Linien. Die Lichtwellen aus den Lücken dazwischen verstärken sich nur in bestimmten Richtungen: geradeaus und zu jeder Seite unter einem Winkel, der mit der Wellenlänge wächst. Rot hat die längsten Wellen und wird am weitesten abgelenkt, umgekehrt wie beim Prisma.',
    },
    wild: {
      en: 'The rainbow on a CD comes from its fine track acting as a grating. Astronomers use gratings to read what stars are made of from their light.',
      de: 'Der Regenbogen auf einer CD entsteht, weil ihre feine Spur als Gitter wirkt. Astronomen lesen mit Gittern aus dem Licht der Sterne ab, woraus sie bestehen.',
    },
    scene: {
      w: 8,
      h: 5,
      entities: [
        { type: 'laser', x: 0, y: 2 },
        { type: 'grating', x: 3, y: 2 },
      ],
    },
  },
];

/** A page becomes readable when the world that introduces its piece opens. */
export function openPages(worlds: WorldDef[], worldOpen: (w: WorldDef) => boolean): NotebookPage[] {
  const open = new Set(worlds.filter((w) => w.object && worldOpen(w)).map((w) => w.object));
  return PAGES.filter((p) => open.has(p.piece));
}
