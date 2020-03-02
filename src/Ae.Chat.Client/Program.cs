using NAudio.Wave;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Sockets;
using System.Threading.Tasks;

namespace Ae.Speak.Server
{
    class Program
    {
        public sealed class UdpStream
        {
            public UdpStream(UdpClient udpClient)
            {
                this.udpClient = udpClient;
            }

            public int PacketSize { get; set; } = 1024;

            private readonly UdpClient udpClient;
            private Queue<byte[]> queue = new Queue<byte[]>();

            public void Write(byte[] buffer)
            {
                if (buffer.Length > PacketSize)
                {
                    int remaining = buffer.Length;
                    int o = 0;

                    while (remaining > 0)
                    {
                        var chunk = buffer.Skip(o).Take(PacketSize).ToArray();
                        o += chunk.Length;
                        remaining -= chunk.Length;
                        queue.Enqueue(chunk);
                    }
                }
            }

            public async Task Tick()
            {
                if (queue.Count == 0 || queue.Sum(x => x.Length) < PacketSize)
                {
                    await Task.Delay(1);
                    return;
                }

                var buffer = queue.Dequeue();
                await udpClient.SendAsync(buffer, buffer.Length);
                Console.WriteLine($"Sent {buffer.Length} bytes {DateTimeOffset.UtcNow.ToUnixTimeSeconds()}");
            }
        }

        static void Main(string[] args)
        {
            DoWork().GetAwaiter().GetResult();
        }

        private static async Task DoWork()
        {
            var socket = new UdpClient();

            Console.WriteLine("Enter server IP address: ");

            socket.Connect(Console.ReadLine(), 8100);

            var capture = new WaveInEvent
            {
                DeviceNumber = -1,
                WaveFormat = new WaveFormat(32000, 2)
            };

            var stream = new UdpStream(socket);

            capture.DataAvailable += (sender, e) =>
            {
                var voiceBuffer = e.Buffer.Take(e.BytesRecorded).ToArray();
                stream.Write(voiceBuffer);
            };
            capture.StartRecording();

            Send(stream);
            Recieve(socket);

            await Task.Delay(-1);

            //using (var random = new RNGCryptoServiceProvider())
            //using (var crypto = new RijndaelManaged())
            //{
            //    while (true)
            //    {
            //        //byte[] salt = new byte[8];
            //        //random.GetBytes(salt);
            //        //crypto.Key = new Rfc2898DeriveBytes("test", salt).GetBytes(32);

            //        //crypto.GenerateIV();
            //        //var encryptor = crypto.CreateEncryptor();

            //        //byte[] buffer;
            //        //using (var ms = new MemoryStream())
            //        //{
            //        //    await ms.WriteAsync(salt);
            //        //    await ms.WriteAsync(crypto.IV);

            //        //    using (var encrypt = new CryptoStream(ms, encryptor, CryptoStreamMode.Write, true))
            //        //    {
            //        //        await encrypt.WriteAsync(waveEvent.Buffer, 0, waveEvent.BytesRecorded);
            //        //    }

            //        //    buffer = ms.ToArray();
            //        //}
            //    }
            //}
        }

        private static async void Send(UdpStream stream)
        {
            while (true)
            {
                await stream.Tick();
            }
        }

        private static async void Recieve(UdpClient socket)
        {
            var waveOut = new WaveOutEvent();

            var waveProvider = new BufferedWaveProvider(new WaveFormat(32000, 2));
            waveOut.Init(waveProvider);
            waveOut.Play();

            while (true)
            {
                var buffer = await socket.ReceiveAsync();
                waveProvider.AddSamples(buffer.Buffer, 0, buffer.Buffer.Length);
            }
        }
    }
}
