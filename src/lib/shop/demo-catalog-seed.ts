/**
 * Demo catalog for the storefront — upserted by `src/new-seed.ts`.
 * Positioning: IT hardware reseller — computers, laptops, printers, CCTV, components.
 * Images: Pexels CDN (replace with your own assets for production).
 */
export type DemoShopProductSeed = {
    slug: string;
    name: string;
    subheading: string;
    description: string;
    category: string;
    pricePaise: number;
    mrpPaise: number;
    badge: string | null;
    imageUrl: string;
    galleryUrls: string[];
    specs: Record<string, string>;
};

export const DEMO_SHOP_CATALOG: DemoShopProductSeed[] = [
    {
        slug: "laptop-business-14-fhd",
        name: "Business Laptop — 14″ FHD · 16 GB · 512 GB NVMe",
        subheading: "Windows 11 Pro ready · metal chassis · all‑day battery",
        description:
            "14″ anti‑glare panel, backlit keyboard, and dual heat pipes for quiet office use. Ideal for sales, education, and field staff. Brand‑neutral build; ask for your preferred OEM on volume orders.",
        category: "Laptops",
        pricePaise: 5299000,
        mrpPaise: 5999000,
        badge: "Popular",
        imageUrl:
            "https://images.pexels.com/photos/1229861/pexels-photo-1229861.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/1229861/pexels-photo-1229861.jpeg?auto=compress&cs=tinysrgb&w=900",
            "https://images.pexels.com/photos/7514838/pexels-photo-7514838.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Display: '14.0″ FHD IPS (1920×1080)',
            Memory: "16 GB DDR4 (1 slot free)",
            Storage: "512 GB NVMe SSD",
            OS: "Windows 11 Pro (downgrade rights on request)",
            Warranty: "1 year carry‑in (extendable)",
        },
    },
    {
        slug: "desktop-tower-i5-16g",
        name: "Tower PC — Core i5 · 16 GB · 512 GB · Wi‑Fi",
        subheading: "Office & billing · tool‑less service door",
        description:
            "Compact ATX tower with room for a second drive and low‑profile GPU. Pre‑imaged or barebone as required. Suitable for front desk, accounts, and light CAD with optional graphics.",
        category: "Desktops",
        pricePaise: 3899000,
        mrpPaise: 4399000,
        badge: "Workhorse",
        imageUrl:
            "https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900",
            "https://images.pexels.com/photos/3862139/pexels-photo-3862139.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            CPU: "Intel Core i5 (12th/13th gen class)",
            RAM: "16 GB DDR4",
            Storage: "512 GB NVMe + 1× 3.5″ bay free",
            Graphics: "Intel UHD (low‑profile GPU optional)",
            Ports: "8× USB, HDMI, DisplayPort, GbE",
        },
    },
    {
        slug: "aio-24-fhd-ssd",
        name: "All‑in‑One — 24″ FHD · SSD · wireless KB/M",
        subheading: "One cable desk · reception & clinic friendly",
        description:
            "Slim 24″ AIO with VESA option and pop‑up privacy webcam. Single power lead keeps counters tidy. Well suited for reception, small clinics, and estate offices.",
        category: "Desktops",
        pricePaise: 4599000,
        mrpPaise: 5099000,
        badge: "New",
        imageUrl:
            "https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900",
            "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Display: '23.8″ FHD touch (non‑touch option)',
            CPU: "Latest gen U‑series",
            Storage: "512 GB NVMe",
            Includes: "Wireless keyboard & mouse",
            Mount: "VESA 100 optional stand",
        },
    },
    {
        slug: "mfp-inkjet-a4-wifi",
        name: "Colour inkjet MFP — A4 · Wi‑Fi · scan & copy",
        subheading: "Home office & SOHO · separate ink tanks",
        description:
            "Print, scan, and copy in A4 with mobile print (iOS/Android) and borderless photo up to 4R. High‑yield tank refills available — ask for your city’s per‑page plan.",
        category: "Printers",
        pricePaise: 1899000,
        mrpPaise: 2199000,
        badge: "Bestseller",
        imageUrl:
            "https://images.pexels.com/photos/1714208/pexels-photo-1714208.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/1714208/pexels-photo-1714208.jpeg?auto=compress&cs=tinysrgb&w=900",
            "https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Functions: "Print / scan / copy",
            Speed: "Up to 15 ppm mono (ISO)",
            Connectivity: "USB, Wi‑Fi, direct mobile",
            "Max paper": "A4 / legal",
            Duty: "Up to 1 500 pages / month (rec.)",
        },
    },
    {
        slug: "laser-mono-duplex-wifi",
        name: "Mono laser — duplex · GbE · Wi‑Fi",
        subheading: "High‑volume text · TCO friendly",
        description:
            "Automatic duplex, 250‑sheet tray, and optional second tray for branch offices. Toner save mode and secure print queue for shared workgroups.",
        category: "Printers",
        pricePaise: 2249000,
        mrpPaise: 2599000,
        badge: "Office",
        imageUrl:
            "https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Speed: "Up to 40 ppm",
            Duplex: "Auto A4",
            Tray: "250 sheets + multipurpose",
            Network: "Ethernet + dual‑band Wi‑Fi",
            "Monthly duty": "Up to 80 000 pages",
        },
    },
    {
        slug: "ip-bullet-camera-5mp-poe",
        name: "IP bullet camera — 5 MP · PoE · IR 40 m",
        subheading: "Outdoor metal housing · ONVIF profile S",
        description:
            "Fixed lens bullet with smart IR and corridor mode for aisles. Powered via PoE switch or injector — ideal for retail fronts, godowns, and lane coverage.",
        category: "CCTV & Security",
        pricePaise: 749900,
        mrpPaise: 899900,
        badge: "PoE",
        imageUrl:
            "https://images.pexels.com/photos/8463140/pexels-photo-8463140.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/8463140/pexels-photo-8463140.jpeg?auto=compress&cs=tinysrgb&w=900",
            "https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Sensor: "5 MP 1/2.7″",
            Lens: "2.8 mm (wide) fixed",
            Night: "IR up to 40 m",
            Power: "DC12 V / PoE 802.3af",
            Protocol: "ONVIF, RTSP, mobile app",
        },
    },
    {
        slug: "nvr-8ch-4k-poe",
        name: "NVR — 8 channels · 4K decode · 4 PoE ports",
        subheading: "Small shop kit · HDMI · dual SATA",
        description:
            "Plug‑and‑play PoE ports for cameras, HDMI spot monitor output, and dual HDD bays for redundancy (RAID optional on firmware). Includes mouse and quick‑start guide.",
        category: "CCTV & Security",
        pricePaise: 1499900,
        mrpPaise: 1749900,
        badge: "Kit ready",
        imageUrl:
            "https://images.pexels.com/photos/4302071/pexels-photo-4302071.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/4302071/pexels-photo-4302071.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Channels: "8 IP (up to 8 MP each)",
            PoE: "4 × 802.3af built‑in",
            Display: "HDMI + VGA",
            Storage: "2 × SATA (up to 8 TB each)",
            Bandwidth: "80 Mbps incoming",
        },
    },
    {
        slug: "ddr5-sodimm-16gb-5600",
        name: "DDR5 SODIMM — 16 GB · 5600 MT/s · laptop",
        subheading: "Single rank · major brand sealed pack",
        description:
            "Drop‑in upgrade for compatible business laptops. XMP not required — JEDEC profile for stability. Bulk pricing available for fleet refreshes.",
        category: "Components",
        pricePaise: 349900,
        mrpPaise: 429900,
        badge: null,
        imageUrl:
            "https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Capacity: "16 GB",
            Speed: "PC5‑44800 (5600 MT/s)",
            Voltage: "1.1 V DDR5",
            Form: "262‑pin SODIMM",
            Compatibility: "DDR5 laptops only",
        },
    },
    {
        slug: "nvme-ssd-1tb-gen4",
        name: "NVMe SSD — 1 TB · PCIe 4.0 ×4",
        subheading: "TLC · DRAM cache · 5‑year warranty class",
        description:
            "Upgrade path for desktops and laptops with M.2 slot. Sequential reads suited to OS + apps + light video. Cloning service available at our service centre.",
        category: "Components",
        pricePaise: 729900,
        mrpPaise: 849900,
        badge: "Fast ship",
        imageUrl:
            "https://images.pexels.com/photos/1181677/pexels-photo-1181677.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/1181677/pexels-photo-1181677.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Interface: "PCIe Gen4 ×4 NVMe 1.4",
            NAND: "3D TLC",
            "Seq. read": "Up to 7000 MB/s class",
            Form: "M.2 2280",
            TBW: "600 TB (typical 1 TB)",
        },
    },
    {
        slug: "psu-gold-650w-modular",
        name: "PSU — 650 W · 80+ Gold · semi‑modular",
        subheading: "ATX · 120 mm fan · overload & OTP",
        description:
            "Reliable replacement or new build supply with flat cables for airflow. Suitable for mid‑tower workstations with discrete GPU up to class‑appropriate draw.",
        category: "Components",
        pricePaise: 629900,
        mrpPaise: 749900,
        badge: null,
        imageUrl:
            "https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Output: "650 W continuous",
            Efficiency: "80 PLUS Gold",
            Rails: "+12 V single rail",
            Connectors: "24‑pin, EPS, PCIe, SATA",
            Warranty: "5 years (brand‑dependent)",
        },
    },
    {
        slug: "monitor-24-fhd-ips-75hz",
        name: "LED monitor — 24″ FHD IPS · 75 Hz",
        subheading: "Thin bezel · HDMI & VGA · VESA",
        description:
            "Flicker‑safe panel for long billing and BPO shifts. 75 Hz smoothness for everyday UI. Tilt stand; VESA mount for arms and wall brackets.",
        category: "Monitors",
        pricePaise: 999900,
        mrpPaise: 1149900,
        badge: "Desk staple",
        imageUrl:
            "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Panel: '23.8″ IPS FHD',
            Refresh: "75 Hz",
            Ports: "HDMI 1.4, VGA, audio out",
            Brightness: "250 nits (typ.)",
            VESA: "100 × 100 mm",
        },
    },
    {
        slug: "usb-wifi6-adapter-ax1800",
        name: "USB Wi‑Fi 6 adapter — AX1800",
        subheading: "Upgrade older desktops to Wi‑Fi 6",
        description:
            "Compact dongle with external antenna option for weak coverage areas. WPA3 support and driver pack for current Windows releases.",
        category: "Networking",
        pricePaise: 189900,
        mrpPaise: 229900,
        badge: null,
        imageUrl:
            "https://images.pexels.com/photos/159304/network-cable-ethernet-computer-159304.jpeg?auto=compress&cs=tinysrgb&w=900",
        galleryUrls: [
            "https://images.pexels.com/photos/159304/network-cable-ethernet-computer-159304.jpeg?auto=compress&cs=tinysrgb&w=900",
        ],
        specs: {
            Standard: "Wi‑Fi 6 (802.11ax)",
            Speed: "AX1800 class",
            Bands: "Dual band 2.4 + 5 GHz",
            Interface: "USB 3.2 Gen1",
            OS: "Windows 10/11 (driver)",
        },
    },
];
