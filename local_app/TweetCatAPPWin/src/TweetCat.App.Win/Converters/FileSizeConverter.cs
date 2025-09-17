using System;
using System.Globalization;
using System.Windows.Data;

namespace TweetCat.App.Win.Converters;

public sealed class FileSizeConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is long size)
        {
            return Format(size);
        }

        if (value is double sizeDouble)
        {
            return Format((long)sizeDouble);
        }

        return "--";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => throw new NotSupportedException();

    private static string Format(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB" };
        double size = bytes;
        var unitIndex = 0;
        while (size >= 1024 && unitIndex < units.Length - 1)
        {
            size /= 1024;
            unitIndex++;
        }

        return $"{size:0.##} {units[unitIndex]}";
    }
}
