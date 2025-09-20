using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace TweetCat.App.Win.Converters;

public sealed class SelectionBrushConverter : IValueConverter
{
    public Brush SelectedBrush { get; set; } = new SolidColorBrush(Color.FromRgb(64, 120, 255));
    public Brush NormalBrush { get; set; } = new SolidColorBrush(Color.FromArgb(80, 255, 255, 255));

    public object Convert(object? value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is bool selected && selected)
        {
            return SelectedBrush;
        }

        return NormalBrush;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => DependencyProperty.UnsetValue;
}
