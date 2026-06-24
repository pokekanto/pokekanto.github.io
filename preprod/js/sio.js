class GameBoyAdvanceSIO {
	constructor() {
		this.SIO_NORMAL_8 = 0;
		this.SIO_NORMAL_32 = 1;
		this.SIO_MULTI = 2;
		this.SIO_UART = 3;
		this.SIO_GPIO = 8;
		this.SIO_JOYBUS = 12;

		this.BAUD = [9600, 38400, 57600, 115200];
	}
	clear() {
		this.mode = this.SIO_GPIO;
		this.sd = false;

		this.irq = false;
		this.multiplayer = {
			baud: 0,
			si: 0,
			id: 0,
			error: 0,
			busy: 0,
			states: [0xffff, 0xffff, 0xffff, 0xffff]
		};

		// Normal 32-bit mode (câble link Pokémon Rouge Feu)
		this.normal32 = {
			busy: false,          // transfert en cours
			irq: false,           // IRQ activée (SIOCNT bit 14)
			clockInternal: false, // bit 0 : true = maître (horloge interne)
			tx: 0,                // données à envoyer
			rx: 0xFFFFFFFF        // données reçues (0xFFFFFFFF = pas de câble)
		};

		this.linkLayer = null;
	}
	setMode(mode) {
		if (mode & 0x8) {
			mode &= 0xc;
		} else {
			mode &= 0x3;
		}
		this.mode = mode;

		this.core.INFO("Setting SIO mode to " + hex(mode, 1));
	}
	writeRCNT(value) {
		if (this.mode != this.SIO_GPIO) {
			return;
		}

		this.core.STUB("General purpose serial not supported");
	}
	writeSIOCNT(value) {
		switch (this.mode) {
			case this.SIO_NORMAL_8:
				this.core.STUB("8-bit transfer unsupported");
				break;

			case this.SIO_NORMAL_32: {
				// SIOCNT Normal 32-bit :
				// bit 0  : clock source (0 = externe/esclave, 1 = interne/maître)
				// bit 7  : start/busy (1 = lancer le transfert)
				// bit 12 : longueur forcée à 1 (32-bit)
				// bit 14 : IRQ enable
				this.normal32.clockInternal = !!(value & 0x0001);
				this.normal32.irq = !!(value & 0x4000);

				if ((value & 0x0080) && !this.normal32.busy) {
					const regs = this.core.io.registers;
					const lo = regs[this.core.io.SIODATA32_LO >> 1] & 0xFFFF;
					const hi = regs[this.core.io.SIODATA32_HI >> 1] & 0xFFFF;
					this.normal32.tx = ((hi << 16) | lo) >>> 0;
					this.normal32.busy = true;

					if (this.linkLayer) {
						this.linkLayer.startNormal32Transfer(this.normal32.tx);
					} else {
						// Pas de câble : répondre immédiatement avec 0xFFFFFFFF
						setTimeout(() => this.completeNormal32Transfer(0xFFFFFFFF), 0);
					}
				}
				break;
			}

			case this.SIO_MULTI:
				this.multiplayer.baud = value & 0x0003;
				if (this.linkLayer) {
					this.linkLayer.setBaud(this.BAUD[this.multiplayer.baud]);
				}

				if (!this.multiplayer.si) {
					this.multiplayer.busy = value & 0x0080;
					if (this.linkLayer && this.multiplayer.busy) {
						this.linkLayer.startMultiplayerTransfer();
					}
				}
				this.irq = value & 0x4000;
				break;

			case this.SIO_UART:
				this.core.STUB("UART unsupported");
				break;
			case this.SIO_GPIO:
				// This register isn't used in general-purpose mode
				break;
			case this.SIO_JOYBUS:
				this.core.STUB("JOY BUS unsupported");
				break;
		}
	}
	readSIOCNT() {
		var value = (this.mode << 12) & 0xffff;
		switch (this.mode) {
			case this.SIO_NORMAL_8:
				this.core.STUB("8-bit transfer unsupported");
				break;

			case this.SIO_NORMAL_32:
				value |= 0x1000;  // bit 12 = 32-bit
				if (this.normal32.clockInternal) value |= 0x0001;
				if (this.normal32.busy)          value |= 0x0080;
				if (this.normal32.irq)           value |= 0x4000;
				break;

			case this.SIO_MULTI:
				value |= this.multiplayer.baud;
				value |= this.multiplayer.si;
				value |= !!this.sd << 3;
				value |= this.multiplayer.id << 4;
				value |= this.multiplayer.error;
				value |= this.multiplayer.busy;
				value |= !!this.multiplayer.irq << 14;
				break;
			case this.SIO_UART:
				this.core.STUB("UART unsupported");
				break;
			case this.SIO_GPIO:
				break;
			case this.SIO_JOYBUS:
				this.core.STUB("JOY BUS unsupported");
				break;
		}
		return value;
	}
	read(slot) {
		switch (this.mode) {
			case this.SIO_NORMAL_32:
				if (slot === 0) return this.normal32.rx & 0xFFFF;
				if (slot === 1) return (this.normal32.rx >>> 16) & 0xFFFF;
				return 0;
			case this.SIO_MULTI:
				return this.multiplayer.states[slot];
			case this.SIO_UART:
				this.core.STUB("UART unsupported");
				break;
			default:
				this.core.WARN("Reading from transfer register in unsupported mode");
				break;
		}
		return 0;
	}

	// Appelé par siolink.js quand les données du pair arrivent via WebRTC.
	completeNormal32Transfer(remoteData32) {
		this.normal32.rx = remoteData32 >>> 0;
		this.normal32.busy = false;

		const regs = this.core.io.registers;
		regs[this.core.io.SIODATA32_LO >> 1] = remoteData32 & 0xFFFF;
		regs[this.core.io.SIODATA32_HI >> 1] = (remoteData32 >>> 16) & 0xFFFF;

		if (this.normal32.irq) {
			this.core.irq.raiseIRQ(this.core.irq.IRQ_SIO);
		}
	}

	// Appelé par siolink.js côté esclave : lire TX sans démarrer de transfert.
	readTxData32() {
		const regs = this.core.io.registers;
		const lo = regs[this.core.io.SIODATA32_LO >> 1] & 0xFFFF;
		const hi = regs[this.core.io.SIODATA32_HI >> 1] & 0xFFFF;
		return ((hi << 16) | lo) >>> 0;
	}
}
