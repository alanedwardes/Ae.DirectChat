using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace Ae.Speak.Server
{
    class Program
    {
        static void Main(string[] args)
        {
            DoWork().GetAwaiter().GetResult();
        }

        private static async Task DoWork()
        {
            var socket = new UdpClient(8100);

            Console.WriteLine("Server started");

            var clients = new HashSet<IPEndPoint>();

            using (var random = new RNGCryptoServiceProvider())
            using (var crypto = new RijndaelManaged())
            {
                while (true)
                {
                    byte[] buffer;

                    var result = await socket.ReceiveAsync();
                    clients.Add(result.RemoteEndPoint);
                    Console.WriteLine($"Received {result.Buffer.Length} bytes from {result.RemoteEndPoint} {DateTimeOffset.UtcNow.ToUnixTimeSeconds()}");

                    foreach (var client in clients)
                    {
                        if (!client.Equals(result.RemoteEndPoint))
                        {
                            socket.SendAsync(result.Buffer, result.Buffer.Length, client);
                        }
                    }

                    //using (var ms = new MemoryStream(result.Buffer))
                    //{
                    //    byte[] salt = new byte[8];
                    //    ms.Read(salt, 0, 8);
                    //    crypto.Key = new Rfc2898DeriveBytes("test", salt).GetBytes(32);

                    //    var iv = new byte[16];
                    //    ms.Read(iv, 0, 16);
                    //    crypto.IV = iv;

                    //    var decryptor = crypto.CreateDecryptor();

                    //    var ms2 = new MemoryStream();

                    //    using (var decrypt = new CryptoStream(ms, decryptor, CryptoStreamMode.Read, true))
                    //    {
                    //        await decrypt.CopyToAsync(ms2);
                    //    }

                    //    buffer = ms2.ToArray();
                    //}
                }
            }
        }
    }
}
