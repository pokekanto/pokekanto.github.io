"use strict";
/*
 Copyright (C) 2012-2015 Grant Galitz
 
 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 
 The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
function GameBoyAdvanceSerial(IOCore) {
    this.IOCore = IOCore;
}
GameBoyAdvanceSerial.prototype.initialize = function () {
    this.SIODATA_A = 0xFFFF;
    this.SIODATA_B = 0xFFFF;
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.SIOShiftClockExternal = 0;
    this.SIOShiftClockDivider = 0x40;
    this.SIOCNT0_DATA = 0x0C;
    this.SIOTransferStarted = false;
    this.SIOMULT_PLAYER_NUMBER = 0;
    this.SIOCOMMERROR = false;
    this.SIOBaudRate = 0;
    this.SIOCNT_UART_CTS = false;
    this.SIOCNT_UART_MISC = 0;
    this.SIOCNT_UART_FIFO = 0;
    this.SIOCNT_IRQ = 0;
    this.SIOCNT_MODE = 0;
    this.SIOCNT_UART_RECV_ENABLE = false;
    this.SIOCNT_UART_SEND_ENABLE = false;
    this.SIOCNT_UART_PARITY_ENABLE = false;
    this.SIOCNT_UART_FIFO_ENABLE = false;
    this.SIODATA8 = 0xFFFF;
    this.RCNTMode = 0;
    this.RCNTIRQ = false;
    this.RCNTDataBits = 0;
    this.RCNTDataBitFlow = 0;
    this.JOYBUS_IRQ = 0;
    this.JOYBUS_CNTL_FLAGS = 0;
    this.JOYBUS_RECV0 = 0xFF;
    this.JOYBUS_RECV1 = 0xFF;
    this.JOYBUS_RECV2 = 0xFF;
    this.JOYBUS_RECV3 = 0xFF;
    this.JOYBUS_SEND0 = 0xFF;
    this.JOYBUS_SEND1 = 0xFF;
    this.JOYBUS_SEND2 = 0xFF;
    this.JOYBUS_SEND3 = 0xFF;
    this.JOYBUS_STAT = 0;
    this.shiftClocks = 0;
    this.serialBitsShifted = 0;
}
GameBoyAdvanceSerial.prototype.SIOMultiplayerBaudRate = [
      9600,
     38400,
     57600,
    115200
];
GameBoyAdvanceSerial.prototype.addClocks = function (clocks) {
    clocks = clocks | 0;
    if ((this.RCNTMode | 0) < 2) {
        switch (this.SIOCNT_MODE | 0) {
            case 0:
            case 1:
                if (this.SIOTransferStarted && (this.SIOShiftClockExternal | 0) == 0) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockSerial();
                    }
                }
                break;
            case 2:
                if (this.SIOTransferStarted && (this.SIOMULT_PLAYER_NUMBER | 0) == 0) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockMultiplayer();
                    }
                }
                break;
            case 3:
                if (this.SIOCNT_UART_SEND_ENABLE && !this.SIOCNT_UART_CTS) {
                    this.shiftClocks = ((this.shiftClocks | 0) + (clocks | 0)) | 0;
                    while ((this.shiftClocks | 0) >= (this.SIOShiftClockDivider | 0)) {
                        this.shiftClocks = ((this.shiftClocks | 0) - (this.SIOShiftClockDivider | 0)) | 0;
                        this.clockUART();
                    }
                }
        }
    }
}
GameBoyAdvanceSerial.prototype.clockSerial = function () {
    //Emulate as if no slaves connected:
    this.serialBitsShifted = ((this.serialBitsShifted | 0) + 1) | 0;
    if ((this.SIOCNT_MODE | 0) == 0) {
        //8-bit
        this.SIODATA8 = ((this.SIODATA8 << 1) | 1) & 0xFFFF;
        if ((this.serialBitsShifted | 0) == 8) {
            this.SIOTransferStarted = false;
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
    else {
        //32-bit
        this.SIODATA_D = ((this.SIODATA_D << 1) & 0xFE) | (this.SIODATA_C >> 7);
        this.SIODATA_C = ((this.SIODATA_C << 1) & 0xFE) | (this.SIODATA_B >> 7);
        this.SIODATA_B = ((this.SIODATA_B << 1) & 0xFE) | (this.SIODATA_A >> 7);
        this.SIODATA_A = ((this.SIODATA_A << 1) & 0xFE) | 1;
        if ((this.serialBitsShifted | 0) == 32) {
            this.SIOTransferStarted = false;
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
}
GameBoyAdvanceSerial.prototype.clockMultiplayer = function () {
    //Valdoria : pont cable link (mode multijoueur) via WebRTC.
    var pont = (typeof window !== "undefined") ? window.ValdoriaLink : null;
    if (pont && pont.actif && typeof pont.masterTransfert === "function") {
        //On delegue : envoi du mot maitre, transfert laisse ouvert (le jeu attend)
        //jusqu'a reception du mot distant -> linkComplete.
        pont.masterTransfert(this);
        return;
    }
    //Emulate as if no slaves connected:
    this.SIODATA_A = this.SIODATA8 | 0;
    this.SIODATA_B = 0xFFFF;
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.SIOTransferStarted = false;
    this.SIOCOMMERROR = true;
    if ((this.SIOCNT_IRQ | 0) != 0) {
        this.IOCore.irq.requestIRQ(0x80);
    }
}
//Valdoria : termine un transfert multijoueur 2 joueurs avec les mots echanges.
GameBoyAdvanceSerial.prototype.linkComplete = function (word0, word1) {
    this.SIODATA_A = word0 & 0xFFFF;   //joueur 0 (maitre)
    this.SIODATA_B = word1 & 0xFFFF;   //joueur 1 (esclave)
    this.SIODATA_C = 0xFFFF;
    this.SIODATA_D = 0xFFFF;
    this.SIOCOMMERROR = false;
    this.SIOTransferStarted = false;
    //Valdoria : pont actif -> on declenche TOUJOURS l'IRQ serie. Le code de Rouge Feu
    //(decompilation : SerialCB -> DoHandshake) ne traite la liaison QUE sur cette IRQ ;
    //l'esclave abandonne apres 10 frames sans IRQ. Le gate IE/IME du jeu protege de toute facon.
    this.IOCore.irq.requestIRQ(0x80);
}
GameBoyAdvanceSerial.prototype.clockUART = function () {
    this.serialBitsShifted = ((this.serialBitsShifted | 0) + 1) | 0;
    if (this.SIOCNT_UART_FIFO_ENABLE) {
        if ((this.serialBitsShifted | 0) == 8) {
            this.serialBitsShifted = 0;
            this.SIOCNT_UART_FIFO = Math.max(((this.SIOCNT_UART_FIFO | 0) - 1) | 0, 0) | 0;
            if ((this.SIOCNT_UART_FIFO | 0) == 0 && (this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
    else {
        if ((this.serialBitsShifted | 0) == 8) {
            this.serialBitsShifted = 0;
            if ((this.SIOCNT_IRQ | 0) != 0) {
                //this.IOCore.irq.requestIRQ(0x80);
            }
        }
    }
}
GameBoyAdvanceSerial.prototype.writeSIODATA_A0 = function (data) {
    data = data | 0;
    this.SIODATA_A = (this.SIODATA_A & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_A0 = function () {
    return this.SIODATA_A & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_A1 = function (data) {
    data = data | 0;
    this.SIODATA_A = (this.SIODATA_A & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_A1 = function () {
    return this.SIODATA_A >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_B0 = function (data) {
    data = data | 0;
    this.SIODATA_B = (this.SIODATA_B & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_B0 = function () {
    return this.SIODATA_B & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_B1 = function (data) {
    data = data | 0;
    this.SIODATA_B = (this.SIODATA_B & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_B1 = function () {
    return this.SIODATA_B >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_C0 = function (data) {
    data = data | 0;
    this.SIODATA_C = (this.SIODATA_C & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_C0 = function () {
    return this.SIODATA_C & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_C1 = function (data) {
    data = data | 0;
    this.SIODATA_C = (this.SIODATA_C & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_C1 = function () {
    return this.SIODATA_C >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_D0 = function (data) {
    data = data | 0;
    this.SIODATA_D = (this.SIODATA_D & 0xFF00) | data;
}
GameBoyAdvanceSerial.prototype.readSIODATA_D0 = function () {
    return this.SIODATA_D & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA_D1 = function (data) {
    data = data | 0;
    this.SIODATA_D = (this.SIODATA_D & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA_D1 = function () {
    return this.SIODATA_D >> 8;
}
GameBoyAdvanceSerial.prototype.writeSIOCNT0 = function (data) {
    if ((this.RCNTMode | 0) < 0x2) {
        switch (this.SIOCNT_MODE | 0) {
            //8-Bit:
            case 0:
            //32-Bit:
            case 1:
                this.SIOShiftClockExternal = data & 0x1;
                this.SIOShiftClockDivider = ((data & 0x2) != 0) ? 0x8 : 0x40;
                this.SIOCNT0_DATA = data & 0xB;
                if ((data & 0x80) != 0) {
                    if (!this.SIOTransferStarted) {
                        this.SIOTransferStarted = true;
                        this.serialBitsShifted = 0;
                        this.shiftClocks = 0;
                    }
                }
                else {
                    this.SIOTransferStarted = false;
                }
                break;
            //Multiplayer:
            case 2:
                this.SIOBaudRate = data & 0x3;
                this.SIOShiftClockDivider = this.SIOMultiplayerBaudRate[this.SIOBaudRate | 0] | 0;
                //Valdoria : si le pont est actif, il impose le numero de joueur (role WebRTC).
                if (!((typeof window !== "undefined") && window.ValdoriaLink && window.ValdoriaLink.actif)) {
                    this.SIOMULT_PLAYER_NUMBER = (data >> 4) & 0x3;
                }
                this.SIOCOMMERROR = ((data & 0x40) != 0);
                if ((data & 0x80) != 0) {
                    if (!this.SIOTransferStarted) {
                        this.SIOTransferStarted = true;
                        if ((this.SIOMULT_PLAYER_NUMBER | 0) == 0) {
                            this.SIODATA_A = 0xFFFF;
                            this.SIODATA_B = 0xFFFF;
                            this.SIODATA_C = 0xFFFF;
                            this.SIODATA_D = 0xFFFF;
                        }
                        this.serialBitsShifted = 0;
                        this.shiftClocks = 0;
                    }
                }
                else {
                    this.SIOTransferStarted = false;
                }
                break;
            //UART:
            case 3:
                this.SIOBaudRate = data & 0x3;
                this.SIOShiftClockDivider = this.SIOMultiplayerBaudRate[this.SIOBaudRate | 0] | 0;
                this.SIOCNT_UART_MISC = (data & 0xCF) >> 2;
                this.SIOCNT_UART_CTS = ((data & 0x4) != 0);
        }
    }
}
GameBoyAdvanceSerial.prototype.readSIOCNT0 = function () {
    if (this.RCNTMode < 0x2) {
        switch (this.SIOCNT_MODE) {
            //8-Bit:
            case 0:
            //32-Bit:
            case 1:
                return ((this.SIOTransferStarted) ? 0x80 : 0) | 0x74 | this.SIOCNT0_DATA;
            //Multiplayer:
            case 2:
                //Valdoria : pont WebRTC actif -> on signale la liaison etablie, sinon le jeu
                //reste bloque sur "Veuillez patienter". bit3 (SD)=tous les GBA prets ;
                //bit2 (SI)=0 parent (joueur 0) / 1 enfant (joueurs 1-3).
                if ((typeof window !== "undefined") && window.ValdoriaLink && window.ValdoriaLink.actif) {
                    return ((this.SIOTransferStarted) ? 0x80 : 0) | 0x8 | (((this.SIOMULT_PLAYER_NUMBER | 0) == 0) ? 0 : 0x4) | (this.SIOMULT_PLAYER_NUMBER << 4) | this.SIOBaudRate;
                }
                return ((this.SIOTransferStarted) ? 0x80 : 0) | ((this.SIOCOMMERROR) ? 0x40 : 0) | (this.SIOMULT_PLAYER_NUMBER << 4) | this.SIOBaudRate;
            //UART:
            case 3:
                return (this.SIOCNT_UART_MISC << 2) | ((this.SIOCNT_UART_FIFO == 4) ? 0x30 : 0x20) | this.SIOBaudRate;
        }
    }
    return 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIOCNT1 = function (data) {
    this.SIOCNT_IRQ = data & 0x40;
    this.SIOCNT_MODE = (data >> 4) & 0x3;
    this.SIOCNT_UART_RECV_ENABLE = ((data & 0x8) != 0);
    this.SIOCNT_UART_SEND_ENABLE = ((data & 0x4) != 0);
    this.SIOCNT_UART_PARITY_ENABLE = ((data & 0x2) != 0);
    this.SIOCNT_UART_FIFO_ENABLE = ((data & 0x1) != 0);
}
GameBoyAdvanceSerial.prototype.readSIOCNT1 = function () {
    return (0x80 | this.SIOCNT_IRQ | (this.SIOCNT_MODE << 4) | ((this.SIOCNT_UART_RECV_ENABLE) ? 0x8 : 0) |
    ((this.SIOCNT_UART_SEND_ENABLE) ? 0x4 : 0) | ((this.SIOCNT_UART_PARITY_ENABLE) ? 0x2 : 0) | ((this.SIOCNT_UART_FIFO_ENABLE) ? 0x2 : 0));
}
GameBoyAdvanceSerial.prototype.writeSIODATA8_0 = function (data) {
    data = data | 0;
    this.SIODATA8 = (this.SIODATA8 & 0xFF00) | data;
    if ((this.RCNTMode | 0) < 0x2 && (this.SIOCNT_MODE | 0) == 3 && this.SIOCNT_UART_FIFO_ENABLE) {
        this.SIOCNT_UART_FIFO = Math.min(((this.SIOCNT_UART_FIFO | 0) + 1) | 0, 4) | 0;
    }
}
GameBoyAdvanceSerial.prototype.readSIODATA8_0 = function () {
    return this.SIODATA8 & 0xFF;
}
GameBoyAdvanceSerial.prototype.writeSIODATA8_1 = function (data) {
    data = data | 0;
    this.SIODATA8 = (this.SIODATA8 & 0xFF) | (data << 8);
}
GameBoyAdvanceSerial.prototype.readSIODATA8_1 = function () {
    return this.SIODATA8 >> 8;
}
GameBoyAdvanceSerial.prototype.writeRCNT0 = function (data) {
    if ((this.RCNTMode | 0) == 0x2) {
        //General Comm:
        var oldDataBits = this.RCNTDataBits | 0;
        this.RCNTDataBits = data & 0xF;    //Device manually controls SI/SO/SC/SD here.
        this.RCNTDataBitFlow = data >> 4;
        if (this.RCNTIRQ && ((oldDataBits ^ this.RCNTDataBits) & oldDataBits & 0x4) != 0) {
            //SI fell low, trigger IRQ:
            //this.IOCore.irq.requestIRQ(0x80);
        }
    }
}
GameBoyAdvanceSerial.prototype.readRCNT0 = function () {
    return (this.RCNTDataBitFlow << 4) | this.RCNTDataBits;
}
GameBoyAdvanceSerial.prototype.writeRCNT1 = function (data) {
    this.RCNTMode = data >> 6;
    this.RCNTIRQ = ((data & 0x1) != 0);
    if ((this.RCNTMode | 0) != 0x2) {
        //Force SI/SO/SC/SD to low as we're never "hooked" up:
        this.RCNTDataBits = 0;
        this.RCNTDataBitFlow = 0;
    }
}
GameBoyAdvanceSerial.prototype.readRCNT1 = function () {
    return (this.RCNTMode << 6) | ((this.RCNTIRQ) ? 0x3F : 0x3E);
}
GameBoyAdvanceSerial.prototype.writeJOYCNT = function (data) {
    this.JOYBUS_IRQ = (data << 25) >> 31;
    this.JOYBUS_CNTL_FLAGS &= ~(data & 0x7);
}
GameBoyAdvanceSerial.prototype.readJOYCNT = function () {
    return (this.JOYBUS_CNTL_FLAGS | 0x40) | (0xB8 & this.JOYBUS_IRQ);
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV0 = function (data) {
    this.JOYBUS_RECV0 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV0 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV0 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV1 = function (data) {
    this.JOYBUS_RECV1 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV1 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV1 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV2 = function (data) {
    this.JOYBUS_RECV2 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV2 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV2 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_RECV3 = function (data) {
    this.JOYBUS_RECV3 = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_RECV3 = function () {
    this.JOYBUS_STAT = this.JOYBUS_STAT & 0xF7;
    return this.JOYBUS_RECV3 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND0 = function (data) {
    this.JOYBUS_SEND0 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND0 = function () {
    return this.JOYBUS_SEND0 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND1 = function (data) {
    this.JOYBUS_SEND1 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND1 = function () {
    return this.JOYBUS_SEND1 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND2 = function (data) {
    this.JOYBUS_SEND2 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND2 = function () {
    return this.JOYBUS_SEND2 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_SEND3 = function (data) {
    this.JOYBUS_SEND3 = data | 0;
    this.JOYBUS_STAT = this.JOYBUS_STAT | 0x2;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_SEND3 = function () {
    return this.JOYBUS_SEND3 | 0;
}
GameBoyAdvanceSerial.prototype.writeJOYBUS_STAT = function (data) {
    this.JOYBUS_STAT = data | 0;
}
GameBoyAdvanceSerial.prototype.readJOYBUS_STAT = function () {
    return 0xC5 | this.JOYBUS_STAT;
}
/*GameBoyAdvanceSerial.prototype.nextIRQEventTime = function (clocks) {
    if ((this.SIOCNT_IRQ | 0) != 0 && (this.RCNTMode | 0) < 2) {
        switch (this.SIOCNT_MODE | 0) {
            case 0:
            case 1:
                if (this.SIOTransferStarted && (this.SIOShiftClockExternal | 0) == 0) {
                    return ((((this.SIOCNT_MODE == 1) ? 31 : 7) - this.serialBitsShifted) * this.SIOShiftClockDivider) + (this.SIOShiftClockDivider - this.shiftClocks);
                }
                else {
                    return 0x7FFFFFFF;
                }
            case 2:
                if (this.SIOTransferStarted && this.SIOMULT_PLAYER_NUMBER == 0) {
                    return this.SIOShiftClockDivider - this.shiftClocks;
                }
                else {
                    return 0x7FFFFFFF;
                }
            case 3:
                if (this.SIOCNT_UART_SEND_ENABLE && !this.SIOCNT_UART_CTS) {
                    return (Math.max(((this.SIOCNT_UART_FIFO_ENABLE) ? (this.SIOCNT_UART_FIFO * 8) : 8) - 1, 0) * this.SIOShiftClockDivider) + (this.SIOShiftClockDivider - this.shiftClocks);
                }
                else {
                    return 0x7FFFFFFF;
                }
        }
    }
    else {
        return 0x7FFFFFFF;
    }
}*/